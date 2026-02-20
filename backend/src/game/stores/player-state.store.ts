import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Socket } from 'socket.io';
import { Character } from '../../character/character.entity';
import { User } from '../../user/user.entity';
import { CharacterService } from '../../character/character.service';
import { BroadcastService } from '../broadcast.service';
import { EnemyStateStore } from './enemy-state.store';
import { CharacterClass } from '../../common/enums/character-class.enum';

// Re-export interfaces from here so callers can import from store
export interface ZoneCharacterState {
    id: string;
    ownerId: string;
    ownerName: string;
    name: string;
    level: number;
    className: string;
    x: number | null;
    y: number | null;
    state: string;
    currentHealth?: number;
    baseHealth?: number;
    attackSpeed?: number;
}

export interface RuntimeCharacterData extends Character {
    targetX: number | null;
    targetY: number | null;
    currentHealth: number;
    ownerId: string;
    ownerName: string;
    baseAttack: number;
    baseDefense: number;
    effectiveAttack: number;
    effectiveDefense: number;
    state: 'idle' | 'moving' | 'attacking' | 'dead' | 'moving_to_loot' | 'looting_area';
    attackTargetId: string | null;
    targetItemId: string | null;
    commandState: 'loot_area' | null;
    anchorX: number | null;
    anchorY: number | null;
    attackRange: number;
    aggroRange: number;
    leashDistance: number;
    attackSpeed: number;
    lastAttackTime: number;
    timeOfDeath: number | null;
    class: CharacterClass;
}

export interface PlayerInZone {
    socket: Socket;
    user: User;
    characters: RuntimeCharacterData[];
}

@Injectable()
export class PlayerStateStore {
    private readonly logger = new Logger(PlayerStateStore.name);
    private players: Map<string, Map<string, PlayerInZone>> = new Map();

    constructor(
        @Inject(forwardRef(() => CharacterService))
        private readonly characterService: CharacterService,
        private readonly broadcastService: BroadcastService,
        @Inject(forwardRef(() => EnemyStateStore))
        private readonly enemyStateStore: EnemyStateStore,
    ) {}

    ensureZone(zoneId: string): void {
        if (!this.players.has(zoneId)) {
            this.players.set(zoneId, new Map());
        }
    }

    getPlayersInZone(zoneId: string): PlayerInZone[] {
        const zonePlayers = this.players.get(zoneId);
        return zonePlayers ? Array.from(zonePlayers.values()) : [];
    }

    getPlayerCount(zoneId: string): number {
        return this.players.get(zoneId)?.size ?? 0;
    }

    getPlayerMap(zoneId: string): Map<string, PlayerInZone> | undefined {
        return this.players.get(zoneId);
    }

    async addPlayerToZone(zoneId: string, playerSocket: Socket, user: User, characters: Character[]): Promise<void> {
        this.ensureZone(zoneId);
        const zonePlayers = this.players.get(zoneId)!;

        const runtimeCharacters: RuntimeCharacterData[] = [];

        for (const char of characters) {
            let effectiveStats = { effectiveAttack: char.baseAttack ?? 0, effectiveDefense: char.baseDefense ?? 0 };
            try {
                effectiveStats = await this.characterService.calculateEffectiveStats(char.id);
            } catch (error) {
                this.logger.error(`Failed to calculate initial effective stats for character ${char.id}: ${error.message}`, error.stack);
            }

            if (!char.class) {
                this.logger.error(`Character ${char.id} fetched from DB is missing the 'class' property! Defaulting.`);
            }

            // Restore saved position if character was last in this zone, otherwise random spawn
            const hasSavedPosition = char.currentZoneId === zoneId && char.positionX != null && char.positionY != null;
            const spawnX = hasSavedPosition ? char.positionX! : (100 + Math.random() * 50);
            const spawnY = hasSavedPosition ? char.positionY! : (100 + Math.random() * 50);

            const runtimeChar: RuntimeCharacterData = {
                ...char,
                positionX: spawnX,
                positionY: spawnY,
                targetX: spawnX,
                targetY: spawnY,
                currentZoneId: zoneId,
                ownerId: user.id,
                ownerName: user.username,
                currentHealth: char.baseHealth, // Always full health on join (currentHealth not persisted in DB)
                baseAttack: char.baseAttack,
                baseDefense: char.baseDefense,
                effectiveAttack: effectiveStats.effectiveAttack,
                effectiveDefense: effectiveStats.effectiveDefense,
                state: 'idle',
                attackTargetId: null,
                targetItemId: null,
                commandState: null,
                anchorX: spawnX,
                anchorY: spawnY,
                attackRange: char.attackRange,
                aggroRange: char.aggroRange,
                leashDistance: char.leashDistance,
                attackSpeed: char.attackSpeed,
                lastAttackTime: 0,
                timeOfDeath: null,
                class: char.class || CharacterClass.FIGHTER,
            };
            runtimeCharacters.push(runtimeChar);
        }

        zonePlayers.set(user.id, { socket: playerSocket, user, characters: runtimeCharacters });
        this.logger.log(`User ${user.username} (${user.id}) added to zone ${zoneId} with ${runtimeCharacters.length} characters.`);

        playerSocket.join(zoneId);

        const selfCharacterStates: ZoneCharacterState[] = runtimeCharacters.map(char => ({
            id: char.id,
            ownerId: char.ownerId,
            ownerName: char.ownerName,
            name: char.name,
            level: char.level,
            className: char.class,
            x: char.positionX,
            y: char.positionY,
            state: char.state,
            currentHealth: char.currentHealth,
            baseHealth: char.baseHealth,
            attackSpeed: char.attackSpeed,
        }));

        // Note: do NOT emit playerJoined here — GameGateway.handleEnterZone already broadcasts it
        // to avoid duplicate events reaching other clients.
    }

    removePlayerFromZone(playerSocket: Socket): { zoneId: string; userId: string } | null {
        const user = playerSocket.data.user as User;
        if (!user) return null;

        for (const [zoneId, zonePlayers] of this.players.entries()) {
            if (zonePlayers.has(user.id)) {
                zonePlayers.delete(user.id);
                playerSocket.leave(zoneId);
                this.logger.log(`User ${user.username} (${user.id}) removed from zone ${zoneId}`);
                return { zoneId, userId: user.id };
            }
        }
        return null;
    }

    getZoneCharacterStates(zoneId: string, excludeUserId?: string): ZoneCharacterState[] {
        const players = this.getPlayersInZone(zoneId);
        const characterStates: ZoneCharacterState[] = [];

        for (const player of players) {
            if (player.user.id === excludeUserId) continue;
            for (const char of player.characters) {
                characterStates.push({
                    id: char.id,
                    ownerId: player.user.id,
                    ownerName: player.user.username,
                    name: char.name,
                    level: char.level,
                    className: char.class,
                    x: char.positionX,
                    y: char.positionY,
                    state: char.state,
                    currentHealth: char.currentHealth,
                    baseHealth: char.baseHealth,
                    attackSpeed: char.attackSpeed,
                });
            }
        }
        return characterStates;
    }

    getPlayerCharacters(userId: string, zoneId?: string): RuntimeCharacterData[] | undefined {
        if (zoneId) {
            return this.players.get(zoneId)?.get(userId)?.characters;
        }
        for (const zonePlayers of this.players.values()) {
            if (zonePlayers.has(userId)) {
                return zonePlayers.get(userId)?.characters;
            }
        }
        return undefined;
    }

    getPlayerCharactersInZone(zoneId: string, playerId: string): RuntimeCharacterData[] {
        const zonePlayers = this.players.get(zoneId);
        if (!zonePlayers) return [];
        const player = zonePlayers.get(playerId);
        if (!player) return [];
        return player.characters;
    }

    getCharacterStateById(zoneId: string, characterId: string): RuntimeCharacterData | undefined {
        const zonePlayers = this.players.get(zoneId);
        if (!zonePlayers) return undefined;
        for (const player of zonePlayers.values()) {
            const character = player.characters.find(c => c.id === characterId);
            if (character) return character;
        }
        return undefined;
    }

    setCharacterTargetPosition(userId: string, characterId: string, targetX: number, targetY: number): { zoneId: string; character: RuntimeCharacterData } | null {
        for (const [zoneId, zonePlayers] of this.players.entries()) {
            const player = zonePlayers.get(userId);
            if (player) {
                const character = player.characters.find(c => c.id === characterId);
                if (character) {
                    character.targetX = targetX;
                    character.targetY = targetY;
                    return { zoneId, character };
                }
            }
        }
        return null;
    }

    updateCharacterCurrentPosition(userId: string, characterId: string, currentX: number, currentY: number): RuntimeCharacterData | null {
        for (const [, zonePlayers] of this.players.entries()) {
            const player = zonePlayers.get(userId);
            if (player) {
                const character = player.characters.find(c => c.id === characterId);
                if (character) {
                    character.positionX = currentX;
                    character.positionY = currentY;
                    return character;
                }
            }
        }
        return null;
    }

    async updateCharacterHealth(ownerId: string, characterId: string, healthChange: number): Promise<number | null> {
        let foundCharacter: RuntimeCharacterData | null = null;

        for (const [, zonePlayers] of this.players.entries()) {
            const player = zonePlayers.get(ownerId);
            if (player) {
                const character = player.characters.find(c => c.id === characterId);
                if (character) {
                    foundCharacter = character;
                    break;
                }
            }
        }

        if (!foundCharacter) {
            this.logger.warn(`Attempted to update health for non-existent character ${characterId} (owner: ${ownerId})`);
            return null;
        }

        const currentHealth = foundCharacter.currentHealth ?? foundCharacter.baseHealth;
        let newHealth = currentHealth + healthChange;
        newHealth = Math.max(0, newHealth);
        newHealth = Math.min(foundCharacter.baseHealth, newHealth);

        if (newHealth !== foundCharacter.currentHealth) {
            foundCharacter.currentHealth = newHealth;
            if (foundCharacter.currentHealth <= 0 && foundCharacter.state !== 'dead') {
                foundCharacter.state = 'dead';
                foundCharacter.timeOfDeath = Date.now();
                foundCharacter.attackTargetId = null;
                foundCharacter.targetX = null;
                foundCharacter.targetY = null;
            }
        }

        return foundCharacter.currentHealth;
    }

    setCharacterHealth(characterId: string, newHealthValue: number): boolean {
        for (const [, zonePlayers] of this.players.entries()) {
            for (const player of zonePlayers.values()) {
                const character = player.characters.find(c => c.id === characterId);
                if (character) {
                    const clampedHealth = Math.max(0, Math.min(character.baseHealth, newHealthValue));
                    if (clampedHealth !== character.currentHealth) {
                        character.currentHealth = clampedHealth;
                    }
                    return true;
                }
            }
        }
        this.logger.warn(`Attempted to set health for non-existent character ${characterId}`);
        return false;
    }

    async updateCharacterEffectiveStats(characterId: string, stats: { effectiveAttack: number; effectiveDefense: number }): Promise<boolean> {
        for (const [, zonePlayers] of this.players.entries()) {
            for (const player of zonePlayers.values()) {
                const characterIndex = player.characters.findIndex(c => c.id === characterId);
                if (characterIndex !== -1) {
                    player.characters[characterIndex].effectiveAttack = stats.effectiveAttack;
                    player.characters[characterIndex].effectiveDefense = stats.effectiveDefense;
                    return true;
                }
            }
        }
        this.logger.warn(`Attempted to update effective stats for character ${characterId}, but they were not found in any active zone.`);
        return false;
    }

    private findCharacterInZone(zoneId: string, characterId: string): RuntimeCharacterData | null {
        const zonePlayers = this.players.get(zoneId);
        if (!zonePlayers) return null;
        for (const player of zonePlayers.values()) {
            const character = player.characters.find(c => c.id === characterId);
            if (character) return character;
        }
        return null;
    }

    setCharacterState(zoneId: string, characterId: string, newState: RuntimeCharacterData['state']): boolean {
        const character = this.findCharacterInZone(zoneId, characterId);
        if (!character) {
            this.logger.warn(`[setCharacterState] Character ${characterId} could not be located in zone ${zoneId}`);
            return false;
        }

        const oldState = character.state;
        if (oldState !== newState) {
            character.state = newState;
            this.broadcastService.queueCharacterStateChange(zoneId, {
                entityId: characterId,
                state: newState,
            });
        }
        return true;
    }

    setMovementTarget(zoneId: string, characterId: string, targetX: number, targetY: number): boolean {
        const character = this.findCharacterInZone(zoneId, characterId);
        if (!character) {
            this.logger.warn(`[setMovementTarget] Character ${characterId} could not be located in zone ${zoneId}`);
            return false;
        }

        character.targetX = targetX;
        character.targetY = targetY;
        character.anchorX = targetX;
        character.anchorY = targetY;
        character.attackTargetId = null;
        character.targetItemId = null;
        character.commandState = null;

        this.setCharacterState(zoneId, characterId, 'moving');
        return true;
    }

    setAttackTarget(zoneId: string, characterId: string, targetEnemyId: string): boolean {
        const character = this.findCharacterInZone(zoneId, characterId);
        if (!character) {
            this.logger.warn(`[setAttackTarget] Character ${characterId} could not be located in zone ${zoneId}`);
            return false;
        }

        const enemy = this.enemyStateStore.getEnemyInstanceById(zoneId, targetEnemyId);
        if (!enemy || enemy.isDying) {
            this.logger.warn(`[setAttackTarget] Target enemy ${targetEnemyId} not found or is dying in zone ${zoneId}.`);
            this.setCharacterState(zoneId, characterId, 'idle');
            return false;
        }

        character.attackTargetId = targetEnemyId;
        character.targetX = null;
        character.targetY = null;
        character.targetItemId = null;
        character.commandState = null;

        this.setCharacterState(zoneId, characterId, 'attacking');
        return true;
    }

    setCharacterLootTarget(userId: string, characterId: string, itemId: string, itemX: number, itemY: number): boolean {
        for (const [, zonePlayers] of this.players.entries()) {
            const player = zonePlayers.get(userId);
            if (player) {
                const character = player.characters.find(c => c.id === characterId);
                if (character && character.state !== 'dead') {
                    character.state = 'moving_to_loot';
                    character.targetItemId = itemId;
                    character.targetX = itemX;
                    character.targetY = itemY;
                    character.attackTargetId = null;
                    return true;
                }
            }
        }
        this.logger.warn(`[PlayerStateStore] Failed to set loot target for character ${characterId} (User: ${userId}). Not found or dead.`);
        return false;
    }

    setCharacterLootArea(userId: string, characterId: string): boolean {
        for (const [, zonePlayers] of this.players.entries()) {
            const player = zonePlayers.get(userId);
            if (player) {
                const character = player.characters.find(c => c.id === characterId);
                if (character && character.state !== 'dead') {
                    if (character.state !== 'looting_area' && character.state !== 'moving_to_loot') {
                        character.state = 'looting_area';
                        character.commandState = 'loot_area';
                        character.targetItemId = null;
                        character.targetX = null;
                        character.targetY = null;
                        character.attackTargetId = null;
                        return true;
                    } else if (character.state === 'moving_to_loot') {
                        character.commandState = 'loot_area';
                        return true;
                    }
                    return true;
                }
            }
        }
        this.logger.warn(`[PlayerStateStore] Failed to set loot area state for character ${characterId} (User: ${userId}). Not found or dead.`);
        return false;
    }

    // Alias used by attacking.state.ts
    getCharacterById(zoneId: string, characterId: string): RuntimeCharacterData | undefined {
        return this.getCharacterStateById(zoneId, characterId);
    }
}
