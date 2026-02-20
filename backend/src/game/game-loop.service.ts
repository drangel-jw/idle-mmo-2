import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Server } from 'socket.io';
import { ZoneService } from './zone.service';
import { RuntimeCharacterData } from './stores/player-state.store';
import { PlayerStateStore } from './stores/player-state.store';
import { EnemyStateStore } from './stores/enemy-state.store';
import { NestStateStore } from './stores/nest-state.store';
import { DroppedItemStore } from './stores/dropped-item.store';
import { SpellQueueStore, QueuedSpellCast } from './stores/spell-queue.store';
import { CombatService } from './combat.service';
import { AIService } from './ai.service';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { CharacterStateService, CharacterTickResult } from './character-state.service';
import { MovementService, MovementResult, Point } from './movement.service';
import { EnemyStateService, EnemyTickResult } from './enemy-state.service';
import { SpawningService } from './spawning.service';
import { BroadcastService } from './broadcast.service';
import { LootService } from '../loot/loot.service';
import { InventoryService } from '../inventory/inventory.service';
import { AbilityService } from '../abilities/ability.service';
import { CharacterService } from '../character/character.service';
import { GameConfig } from '../common/config/game.config';

@Injectable()
export class GameLoopService implements OnApplicationShutdown {
    private logger: Logger = new Logger('GameLoopService');
    private gameLoopTimeout: NodeJS.Timeout | null = null;
    private isLoopRunning = false;
    private server: Server | null = null;

    private readonly TICK_RATE = GameConfig.GAME_LOOP.TICK_RATE_MS;
    private lastPositionSaveTime = 0;

    constructor(
        private zoneService: ZoneService,
        private readonly playerStateStore: PlayerStateStore,
        private readonly enemyStateStore: EnemyStateStore,
        private readonly nestStateStore: NestStateStore,
        private readonly droppedItemStore: DroppedItemStore,
        private readonly spellQueueStore: SpellQueueStore,
        private combatService: CombatService,
        private aiService: AIService,
        private characterStateService: CharacterStateService,
        private movementService: MovementService,
        private enemyStateService: EnemyStateService,
        private spawningService: SpawningService,
        private broadcastService: BroadcastService,
        private lootService: LootService,
        private inventoryService: InventoryService,
        private abilityService: AbilityService,
        private characterService: CharacterService,
    ) {}

    startLoop(serverInstance: Server): void {
        if (!this.isLoopRunning) {
            this.server = serverInstance;
            this.broadcastService.setServerInstance(serverInstance);
            this.logger.log(`Starting game loop with tick rate ${this.TICK_RATE}ms`);
            this.isLoopRunning = true;
            this.scheduleNextTick();
        }
    }

    onApplicationShutdown(signal?: string) {
        this.logger.log(`Stopping game loop due to ${signal ? signal : 'shutdown'}...`);
        this.isLoopRunning = false;
        if (this.gameLoopTimeout) {
            clearTimeout(this.gameLoopTimeout);
            this.gameLoopTimeout = null;
        }
        this.logger.log('Game loop stopped.');
    }

    private scheduleNextTick(): void {
        if (this.gameLoopTimeout) {
            clearTimeout(this.gameLoopTimeout);
        }
        this.gameLoopTimeout = setTimeout(async () => {
            if (this.isLoopRunning) {
                await this.tickGameLoop();
                this.scheduleNextTick();
            }
        }, this.TICK_RATE);
    }

    private async tickGameLoop(): Promise<void> {
        if (!this.server) {
            this.logger.error('Game loop running without a server instance!');
            return;
        }
        const startTime = Date.now();
        const now = startTime;
        const deltaTime = this.TICK_RATE / 1000.0;

        for (const zoneId of this.zoneService.getActiveZoneIds()) {
          try {
                const playersInZone = this.playerStateStore.getPlayersInZone(zoneId);
                const currentEnemiesInZone = this.enemyStateStore.getZoneEnemies(zoneId);

                if (playersInZone.length === 0 && currentEnemiesInZone.length === 0) continue;

                // --- Character Processing ---
                for (const player of playersInZone) {
                    for (const character of player.characters) {
                        const initialHealth = character.currentHealth;
                        const initialState = character.state;

                        const tickResult: CharacterTickResult = await this.characterStateService.processCharacterTick(
                            character,
                            player.user.id,
                            zoneId,
                            currentEnemiesInZone,
                            player.characters.filter(c => c.id !== character.id),
                            now,
                            deltaTime
                        );

                        tickResult.combatActions.forEach(action => {
                            this.broadcastService.queueCombatAction(zoneId, action);
                        });

                        tickResult.enemyHealthUpdates.forEach(enemyUpdate => {
                            const enemy = this.enemyStateStore.getEnemyInstanceById(zoneId, enemyUpdate.id);
                            const updatePayload = {
                                id: enemyUpdate.id,
                                x: enemy?.position.x,
                                y: enemy?.position.y,
                                health: enemyUpdate.health
                            };
                            this.broadcastService.queueEntityUpdate(zoneId, updatePayload);
                        });

                        if (tickResult.diedThisTick) {
                            this.broadcastService.queueDeath(zoneId, { entityId: character.id, type: 'character' });
                            const deathUpdate = { id: character.id, health: 0, state: 'dead' };
                            this.broadcastService.queueEntityUpdate(zoneId, deathUpdate);
                            continue;
                        }

                         if (tickResult.respawnedThisTick) {
                              const respawnUpdate = { id: character.id, x: character.positionX, y: character.positionY, health: character.currentHealth, state: 'idle' };
                              this.broadcastService.queueEntityUpdate(zoneId, respawnUpdate);
                              continue;
                         }

                        if (tickResult.pickedUpItemId) {
                            this.broadcastService.queueItemPickedUp(zoneId, tickResult.pickedUpItemId);
                            const playerSocket = player.socket;
                            if (playerSocket) {
                                try {
                                    const updatedInventory = await this.inventoryService.getUserInventory(player.user.id);
                                    playerSocket.emit('inventoryUpdate', { inventory: updatedInventory });
                                } catch (error) {
                                    this.logger.error(`Failed to send inventoryUpdate to ${player.user.username} after pickup: ${error.message}`, error.stack);
                                }
                            }
                        }

                        // --- Movement Simulation ---
                         let needsPositionUpdate = false;
                         const currentPosition: Point = { x: character.positionX ?? 0, y: character.positionY ?? 0 };
                         const targetPosition: Point | null = (character.targetX !== null && character.targetY !== null)
                                                              ? { x: character.targetX, y: character.targetY }
                                                              : null;

                         if (targetPosition) {
                             const characterSpeed = GameConfig.MOVEMENT.CHARACTER_SPEED_PPS;
                             const moveResult: MovementResult = this.movementService.simulateMovement(
                                 currentPosition,
                                 targetPosition,
                                 characterSpeed,
                                 deltaTime
                             );

                             if (moveResult.newPosition.x !== character.positionX || moveResult.newPosition.y !== character.positionY) {
                                needsPositionUpdate = true;
                                character.positionX = moveResult.newPosition.x;
                                character.positionY = moveResult.newPosition.y;
                                this.playerStateStore.updateCharacterCurrentPosition(player.user.id, character.id, character.positionX, character.positionY);
                             }
                         }

                         const healthChanged = character.currentHealth !== initialHealth;
                         const stateChanged = character.state !== initialState;

                         if (needsPositionUpdate || healthChanged || stateChanged) {
                             const updateData = {
                                 id: character.id,
                                 x: character.positionX,
                                 y: character.positionY,
                                 health: character.currentHealth,
                                 state: character.state,
                                 className: character.class
                             };
                              this.broadcastService.queueEntityUpdate(zoneId, updateData);
                         }

                    } // End character loop
                } // End player loop

                // --- Process Queued Spell Casts ---
                const queuedSpells = this.spellQueueStore.getAndClearQueuedSpells(zoneId);
                for (const spell of queuedSpells) {
                    await this.processSpellCast(spell, zoneId, now);
                }

                // --- Enemy AI, State & Movement Processing ---
                 const currentEnemies = this.enemyStateStore.getZoneEnemies(zoneId);
                for (const enemy of currentEnemies) {
                    if (enemy.isDying) {
                        let positionChanged = false;

                        if (enemy.knockbackState) {
                            const knockback = enemy.knockbackState;
                            const elapsed = now - knockback.startTime;

                            if (elapsed <= knockback.duration) {
                                const progress = elapsed / knockback.duration;
                                const easedProgress = 1 - Math.pow(1 - progress, 3);
                                const offsetDistance = knockback.distance * easedProgress;
                                const newX = knockback.originalPosition.x + (knockback.direction.x * offsetDistance);
                                const newY = knockback.originalPosition.y + (knockback.direction.y * offsetDistance);

                                if (Math.abs(enemy.position.x - newX) > 0.1 || Math.abs(enemy.position.y - newY) > 0.1) {
                                    enemy.position.x = newX;
                                    enemy.position.y = newY;
                                    positionChanged = true;
                                }
                            } else {
                                enemy.knockbackState = undefined;
                                this.logger.debug(`[ENEMY DEATH] Knockback completed for ${enemy.name} (${enemy.id})`);
                            }
                        }

                        if (positionChanged) {
                            const updateData = { id: enemy.id, x: enemy.position.x, y: enemy.position.y };
                            this.broadcastService.queueEntityUpdate(zoneId, updateData);
                        }

                        continue;
                    }

                    if (enemy.currentHealth <= 0) continue;

                     const enemyTickResult: EnemyTickResult = await this.enemyStateService.processEnemyTick(
                         enemy,
                         zoneId,
                         now,
                         deltaTime
                     );

                    enemyTickResult.combatActions.forEach(action => {
                        this.broadcastService.queueCombatAction(zoneId, action);
                    });

                     enemyTickResult.characterHealthUpdates.forEach(charUpdate => {
                        const charState = this.playerStateStore.getCharacterStateById(zoneId, charUpdate.id);
                        const updatePayload = {
                            id: charUpdate.id,
                            x: charState?.positionX,
                            y: charState?.positionY,
                            health: charUpdate.health,
                            className: charState?.class
                        };
                         this.broadcastService.queueEntityUpdate(zoneId, updatePayload);
                     });

                     if (enemyTickResult.targetDied) {
                        const deadCharId = enemyTickResult.characterHealthUpdates.find(upd => upd.health <= 0)?.id;
                        if (deadCharId) {
                            this.broadcastService.queueDeath(zoneId, { entityId: deadCharId, type: 'character' });
                             const charState = this.playerStateStore.getCharacterStateById(zoneId, deadCharId);
                             const deadUpdate = { id: deadCharId, x: charState?.positionX, y: charState?.positionY, health: 0, state: 'dead' };
                             this.broadcastService.queueEntityUpdate(zoneId, deadUpdate);
                        } else {
                            this.logger.warn(`Enemy ${enemy.id} reported targetDied, but couldn't find dead character ID in health updates.`);
                        }
                     }

                    // --- Enemy Movement Simulation ---
                    let enemyNeedsPositionUpdate = false;
                    const enemyCurrentPos: Point = { x: enemy.position.x, y: enemy.position.y };
                    const enemyTargetPos: Point | null = enemy.target ?? null;

                     if (enemyTargetPos) {
                         const enemySpeed = enemy.baseSpeed || 75;

                         const enemyMoveResult: MovementResult = this.movementService.simulateMovement(
                             enemyCurrentPos,
                             enemyTargetPos,
                             enemySpeed,
                             deltaTime
                         );

                         if (enemyMoveResult.newPosition.x !== enemy.position.x || enemyMoveResult.newPosition.y !== enemy.position.y) {
                            enemyNeedsPositionUpdate = true;
                            enemy.position.x = enemyMoveResult.newPosition.x;
                            enemy.position.y = enemyMoveResult.newPosition.y;
                            this.enemyStateStore.updateEnemyPosition(zoneId, enemy.id, enemy.position);
                         }

                         if (enemyMoveResult.reachedTarget) {
                            enemy.target = null;
                            this.enemyStateStore.setEnemyTarget(zoneId, enemy.id, null);

                             if (enemy.aiState === 'WANDERING' || enemy.aiState === 'LEASHED') {
                                 this.enemyStateStore.setEnemyAiState(zoneId, enemy.id, 'IDLE');
                             }
                         }
                     }

                    if (enemyNeedsPositionUpdate) {
                        const updateData = {
                            id: enemy.id,
                            x: enemy.position.x,
                            y: enemy.position.y
                        };
                        this.broadcastService.queueEntityUpdate(zoneId, updateData);
                    }
                } // End enemy loop

                // --- Nest Spawning Check ---
                const newlySpawnedEnemies = await this.spawningService.processNestSpawns(zoneId, now);
                newlySpawnedEnemies.forEach(newEnemy => {
                    this.broadcastService.queueSpawn(zoneId, newEnemy);
                });

                // --- Dropped Item Despawn Check ---
                const currentDroppedItems = this.droppedItemStore.getDroppedItems(zoneId);
                for (const droppedItem of currentDroppedItems) {
                    if (now >= droppedItem.despawnTime) {
                        const removed = this.droppedItemStore.removeDroppedItem(zoneId, droppedItem.id);
                        if (removed) {
                            this.broadcastService.queueItemDespawned(zoneId, removed.id);
                        }
                    }
                }

                // --- Dying Enemy Cleanup Check ---
                const dyingEnemies = this.enemyStateStore.getZoneEnemies(zoneId).filter(e => e.isDying);
                for (const dyingEnemy of dyingEnemies) {
                    if (dyingEnemy.deathTimestamp && (now - dyingEnemy.deathTimestamp) >= GameConfig.SPAWNING.DYING_CLEANUP_MS) {
                        this.logger.debug(`[ENEMY DEATH] Cleaning up decayed enemy ${dyingEnemy.name} (${dyingEnemy.id}) after 10 seconds`);
                        this.enemyStateStore.removeEnemy(zoneId, dyingEnemy.id);
                    }
                }

                // --- Flush All Queued Events ---
                this.broadcastService.flushZoneEvents(zoneId);

          } catch (error) {
              this.logger.error(`Error processing zone ${zoneId}: ${error.message}`, error.stack);
          }
        } // End zone loop

        // --- Periodic Position Persistence ---
        if (now - this.lastPositionSaveTime >= GameConfig.PERSISTENCE.POSITION_SAVE_INTERVAL_MS) {
            this.lastPositionSaveTime = now;
            const positionUpdates: Array<{ characterId: string; positionX: number; positionY: number; currentZoneId: string }> = [];
            for (const zoneId of this.zoneService.getActiveZoneIds()) {
                const players = this.playerStateStore.getPlayersInZone(zoneId);
                for (const player of players) {
                    for (const character of player.characters) {
                        if (character.positionX !== null && character.positionY !== null) {
                            positionUpdates.push({
                                characterId: character.id,
                                positionX: character.positionX,
                                positionY: character.positionY,
                                currentZoneId: zoneId,
                            });
                        }
                    }
                }
            }
            if (positionUpdates.length > 0) {
                this.characterService.saveCharacterPositions(positionUpdates).catch(err => {
                    this.logger.error(`Position save failed: ${err.message}`);
                });
            }
        }

        const endTime = Date.now();
        const duration = endTime - startTime;
        if (duration > this.TICK_RATE) {
            this.logger.warn(`Game loop for tick took ${duration}ms, exceeding tick rate of ${this.TICK_RATE}ms.`);
        }
    }

    private async processSpellCast(spell: QueuedSpellCast, zoneId: string, now: number): Promise<void> {
        try {
            const caster = this.playerStateStore.getCharacterStateById(zoneId, spell.casterId);
            if (!caster) {
                this.logger.warn(`[ProcessSpell] Caster ${spell.casterId} not found in zone ${zoneId}`);
                return;
            }

            const ability = await this.abilityService.findById(spell.abilityId);
            if (!ability) {
                this.logger.warn(`[ProcessSpell] Ability ${spell.abilityId} not found`);
                return;
            }

            this.logger.log(`Processing spell: ${caster.name} casting ${ability.name} at (${spell.targetX}, ${spell.targetY})`);

            const spellResults = await this.combatService.handleSpellDamage(
                caster,
                spell.targetX,
                spell.targetY,
                ability.radius || 100,
                ability.damage || 50,
                zoneId
            );

            const enemyHealthUpdates: Array<{ id: string; health: number }> = [];
            for (const result of spellResults) {
                enemyHealthUpdates.push({
                    id: result.enemyId,
                    health: result.targetCurrentHealth
                });
            }

            enemyHealthUpdates.forEach(enemyUpdate => {
                const enemy = this.enemyStateStore.getEnemyInstanceById(zoneId, enemyUpdate.id);
                const updatePayload = {
                    id: enemyUpdate.id,
                    x: enemy?.position.x,
                    y: enemy?.position.y,
                    health: enemyUpdate.health
                };
                this.broadcastService.queueEntityUpdate(zoneId, updatePayload);
            });

            if (spellResults.length > 0) {
                const spellDamageData = {
                    abilityId: ability.id,
                    abilityName: ability.name,
                    targetX: spell.targetX,
                    targetY: spell.targetY,
                    radius: ability.radius || 100,
                    damage: ability.damage || 50,
                    affectedEnemies: spellResults.map(result => ({
                        enemyId: result.enemyId,
                        damage: result.damageDealt
                    }))
                };

                this.broadcastService.queueSpellDamage(zoneId, spellDamageData);
                this.logger.log(`Spell processed: ${spellResults.length} enemies hit`);
            }

            this.broadcastService.queueSpellCast(zoneId, {
                casterId: caster.id,
                abilityId: ability.id,
                abilityName: ability.name,
                targetX: spell.targetX,
                targetY: spell.targetY,
                radius: ability.radius,
            });

        } catch (error) {
            this.logger.error(`[ProcessSpell] Error processing spell ${spell.id}: ${error.message}`, error.stack);
        }
    }
}
