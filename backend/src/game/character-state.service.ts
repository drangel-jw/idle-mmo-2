import { Injectable, Logger } from '@nestjs/common';
import { RuntimeCharacterData } from './stores/player-state.store';
import { PlayerStateStore } from './stores/player-state.store';
import { EnemyStateStore } from './stores/enemy-state.store';
import { DroppedItemStore } from './stores/dropped-item.store';
import { CombatService } from './combat.service';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { InventoryService } from '../inventory/inventory.service';
import { BroadcastService } from './broadcast.service';
import { EnemyService } from '../enemy/enemy.service';
import { CharacterService } from '../character/character.service';
import { GameConfig } from '../common/config/game.config';

import {
    ICharacterState,
    CharacterStateDependencies,
    StateProcessResult,
} from './character-states/character-state.interface';
import { IdleState } from './character-states/idle.state';
import { MovingState } from './character-states/moving.state';
import { AttackingState } from './character-states/attacking.state';
import { MovingToLootState } from './character-states/moving-to-loot.state';
import { LootingAreaState } from './character-states/looting-area.state';

export interface CharacterTickResult {
    characterData: RuntimeCharacterData;
    combatActions: any[];
    enemyHealthUpdates: Array<{ id: string, health: number }>;
    diedThisTick: boolean;
    respawnedThisTick: boolean;
    targetDied: boolean;
    pickedUpItemId: string | null;
}


@Injectable()
export class CharacterStateService {
    private readonly logger = new Logger(CharacterStateService.name);
     private readonly RESPAWN_TIME_MS = GameConfig.CHARACTER.RESPAWN_TIME_MS;
     private readonly CHARACTER_HEALTH_REGEN_PERCENT_PER_SEC = GameConfig.CHARACTER.HEALTH_REGEN_PERCENT_PER_SEC;
     private readonly ITEM_PICKUP_RANGE_SQ = GameConfig.INVENTORY.ITEM_PICKUP_RANGE * GameConfig.INVENTORY.ITEM_PICKUP_RANGE;

    private stateHandlers: Map<string, ICharacterState>;
    private dependencies: CharacterStateDependencies;

    constructor(
        private readonly playerStateStore: PlayerStateStore,
        private readonly enemyStateStore: EnemyStateStore,
        private readonly droppedItemStore: DroppedItemStore,
        private combatService: CombatService,
        private inventoryService: InventoryService,
        private broadcastService: BroadcastService,
        private enemyService: EnemyService,
        private characterService: CharacterService,
    ) {
        this.dependencies = {
            playerStateStore: this.playerStateStore,
            enemyStateStore: this.enemyStateStore,
            droppedItemStore: this.droppedItemStore,
            combatService: this.combatService,
            inventoryService: this.inventoryService,
            characterService: this.characterService,
            enemyService: this.enemyService,
            ITEM_PICKUP_RANGE_SQ: this.ITEM_PICKUP_RANGE_SQ,
        };

        this.stateHandlers = new Map<string, ICharacterState>([
            ['idle', new IdleState()],
            ['moving', new MovingState()],
            ['attacking', new AttackingState()],
            ['moving_to_loot', new MovingToLootState()],
            ['looting_area', new LootingAreaState()],
        ]);
    }

    async processCharacterTick(
        character: RuntimeCharacterData,
        playerId: string,
        zoneId: string,
        enemiesInZone: EnemyInstance[],
        siblingCharacters: RuntimeCharacterData[],
        now: number,
        deltaTime: number,
    ): Promise<CharacterTickResult> {

        if (character.positionX === null || character.positionY === null) {
            this.logger.warn(`Character ${character.id} has null position. Setting to default spawn and anchor.`);
            character.positionX = GameConfig.CHARACTER.DEFAULT_SPAWN_X;
            character.positionY = GameConfig.CHARACTER.DEFAULT_SPAWN_Y;
            if (character.anchorX === null || character.anchorY === null) {
                character.anchorX = character.positionX;
                character.anchorY = character.positionY;
                this.logger.warn(`Character ${character.id} also had null anchor. Set anchor to spawn point.`);
            }
        }

        const tickResult: CharacterTickResult = {
             characterData: character,
             combatActions: [],
             enemyHealthUpdates: [],
             diedThisTick: false,
             respawnedThisTick: false,
             targetDied: false,
             pickedUpItemId: null,
        };

        // --- Respawn Check ---
        if (character.state === 'dead') {
            if (character.timeOfDeath === null) {
                this.logger.error(`Character ${character.id} in dead state but timeOfDeath is null! Setting timeOfDeath now.`);
                character.timeOfDeath = now;
                return tickResult;
            }
            if (now >= character.timeOfDeath + this.RESPAWN_TIME_MS) {
                character.currentHealth = character.baseHealth;
                this.playerStateStore.setCharacterState(zoneId, character.id, 'idle');
                character.timeOfDeath = null;
                character.positionX = character.anchorX ?? GameConfig.CHARACTER.DEFAULT_SPAWN_X;
                character.positionY = character.anchorY ?? GameConfig.CHARACTER.DEFAULT_SPAWN_Y;
                character.attackTargetId = null;
                character.targetX = null;
                character.targetY = null;
                character.targetItemId = null;
                character.commandState = null;
                tickResult.respawnedThisTick = true;
            }
            return tickResult;
        }

        // --- Death Check ---
        if (character.currentHealth <= 0) {
            character.timeOfDeath = now;
            this.playerStateStore.setCharacterState(zoneId, character.id, 'dead');
            character.attackTargetId = null;
            character.targetX = null;
            character.targetY = null;
            character.targetItemId = null;
            character.commandState = null;
            tickResult.diedThisTick = true;
            return tickResult;
        }

        // --- Health Regeneration ---
        if (character.currentHealth < character.baseHealth && character.state !== 'attacking') {
             const regenAmount = (character.baseHealth * (this.CHARACTER_HEALTH_REGEN_PERCENT_PER_SEC / 100)) * deltaTime;
             if (regenAmount > 0) {
                 const newHealth = Math.min(character.baseHealth, character.currentHealth + regenAmount);
                 character.currentHealth = newHealth;
             }
        }

        // --- Leashing Check ---
        let isLeashing = false;
        if (character.anchorX !== null && character.anchorY !== null && character.leashDistance > 0) {
            const distToAnchorSq = (character.positionX - character.anchorX)**2 + (character.positionY - character.anchorY)**2;
            if (distToAnchorSq > character.leashDistance * character.leashDistance) {
                isLeashing = true;
                if (character.state !== 'moving' || character.targetX !== character.anchorX || character.targetY !== character.anchorY) {
                    this.playerStateStore.setMovementTarget(zoneId, character.id, character.anchorX, character.anchorY);
                }
            }
        }

        // --- State Logic Delegation ---
        const currentStateHandler = this.stateHandlers.get(character.state);
        let stateResult: StateProcessResult | null = null;

        if (currentStateHandler) {
            stateResult = await currentStateHandler.processTick(
                character,
                this.dependencies,
                zoneId,
                enemiesInZone,
                siblingCharacters,
                now,
                deltaTime
            );
        } else {
            this.logger.error(`[Tick ${character.id}] Unknown state: '${character.state}'. Setting to idle.`);
            this.playerStateStore.setCharacterState(zoneId, character.id, 'idle');
            character.attackTargetId = null;
            character.targetX = null;
            character.targetY = null;
            character.targetItemId = null;
            character.commandState = null;
        }

        // --- Aggregate Results ---
        if (stateResult) {
            tickResult.combatActions.push(...stateResult.combatActions);
            tickResult.enemyHealthUpdates.push(...stateResult.enemyHealthUpdates);
            tickResult.targetDied = tickResult.targetDied || stateResult.targetDied;
            tickResult.pickedUpItemId = tickResult.pickedUpItemId || stateResult.pickedUpItemId;
        }

        tickResult.characterData = character;
        return tickResult;
    }
}
