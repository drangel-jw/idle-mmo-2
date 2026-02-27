import { Injectable, Logger } from '@nestjs/common';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { AIAction, AIActionMoveTo } from './interfaces/ai-action.interface';
import { RuntimeCharacterData } from './stores/player-state.store';
import { PlayerStateStore } from './stores/player-state.store';
import { EnemyStateStore } from './stores/enemy-state.store';
import { GameConfig } from '../common/config/game.config';

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  private readonly ENEMY_AGGRO_RANGE = GameConfig.AI.AGGRO_RANGE;
  private readonly ENEMY_ATTACK_RANGE = GameConfig.AI.ATTACK_RANGE;
  private readonly ATTACK_COOLDOWN = GameConfig.AI.ATTACK_COOLDOWN_MS;
  private readonly WANDER_CHANCE = GameConfig.AI.WANDER_CHANCE;
  private readonly ENEMY_LEASH_DISTANCE_FACTOR = GameConfig.AI.LEASH_DISTANCE_FACTOR;

  constructor(
    private readonly playerStateStore: PlayerStateStore,
    private readonly enemyStateStore: EnemyStateStore,
  ) {}

  /**
   * Determines the next action for a given enemy instance based on its state and surroundings.
   */
  updateEnemyAI(enemy: EnemyInstance, zoneId: string): AIAction {
    const now = Date.now();
  
    // --- Always check if dead or dying first ---
    if (enemy.currentHealth <= 0 || enemy.isDying) {
        if (enemy.aiState !== 'DEAD') {
             this.enemyStateStore.setEnemyAiState(zoneId, enemy.id, 'DEAD');
             enemy.aiState = 'DEAD'; // Update local state
        }
        return { type: 'IDLE' };
    }

    // --- Handle Engaged States (Attacking, Chasing) ---
    if (enemy.aiState === 'ATTACKING' || enemy.aiState === 'CHASING') {
        const targetCharacter = enemy.currentTargetId ? this.playerStateStore.getCharacterStateById(zoneId, enemy.currentTargetId) : null;

        // Check if current target is valid
        if (!targetCharacter || targetCharacter.currentHealth <= 0 || targetCharacter.state === 'dead') {
             // --- ADDED: Scan for new target immediately after a kill/invalid target --- 
             const closestPlayer = this.findClosestPlayer(enemy, zoneId);
             if (closestPlayer && this.calculateDistance(enemy.position, closestPlayer) <= this.ENEMY_AGGRO_RANGE) {
                 enemy.currentTargetId = closestPlayer.id;
                 this.setState(enemy, zoneId, 'CHASING', closestPlayer);
                 return { type: 'MOVE_TO', target: { x: closestPlayer.positionX!, y: closestPlayer.positionY! } };
             } else {
                 // --- No new target found, NOW become IDLE ---
                 this.setState(enemy, zoneId, 'IDLE', null);
                 enemy.currentTargetId = null;
                 return { type: 'IDLE' };
             }
             // ---------------------------------------------------------------------
        }

        // Target is valid, check distance
        const distanceToTarget = this.calculateDistance(enemy.position, targetCharacter);

        // Check if in Attack Range
        if (distanceToTarget <= this.ENEMY_ATTACK_RANGE) {
            // --- In Range --- 
            // Check Attack Cooldown *before* deciding to attack
            if (now >= (enemy.lastAttackTime || 0) + this.ATTACK_COOLDOWN) {
                // Cooldown finished: ATTACK!
                this.setState(enemy, zoneId, 'ATTACKING', null); // Ensure state is attacking, clear movement target
                enemy.lastAttackTime = now; // Record attack time
                this.enemyStateStore.updateEnemyAttackTime(zoneId, enemy.id, now); // Persist attack time
                return {
                    type: 'ATTACK',
                    targetEntityId: targetCharacter.id,
                    targetEntityType: 'character',
                };
            } else {
                // Still on Cooldown: Remain in ATTACKING state but do nothing this tick
                this.setState(enemy, zoneId, 'ATTACKING', null); // Ensure state stays attacking, clear movement target
                return { type: 'IDLE' }; // No action while cooling down
            }
        } else {
            // --- Out of Range: CHASE --- 
            this.setState(enemy, zoneId, 'CHASING', targetCharacter);
            return {
               type: 'MOVE_TO',
               target: { x: targetCharacter.positionX!, y: targetCharacter.positionY! },
            };
        }
    }

    // --- Handle Non-Engaged States (Idle, Wandering, Leashed) ---
    else {
        // Leashing Check
        if (enemy.anchorX !== undefined && enemy.anchorY !== undefined && enemy.wanderRadius !== undefined) {
            const leashDistance = enemy.wanderRadius * this.ENEMY_LEASH_DISTANCE_FACTOR;
            const distToAnchorSq = (enemy.position.x - enemy.anchorX)**2 + (enemy.position.y - enemy.anchorY)**2;

            if (distToAnchorSq > leashDistance * leashDistance) {
                if (enemy.aiState !== 'LEASHED') {
                    this.setState(enemy, zoneId, 'LEASHED', { x: enemy.anchorX, y: enemy.anchorY });
                }
                return { type: 'MOVE_TO', target: { x: enemy.anchorX, y: enemy.anchorY } };
            }
        }

        // If was leashed but now back in range
        if (enemy.aiState === 'LEASHED') {
            this.setState(enemy, zoneId, 'IDLE', null);
            return { type: 'IDLE' };
        }

        // Logic for IDLE and WANDERING
        if (enemy.aiState === 'IDLE') {
             // Aggro Scan first when IDLE
             const closestPlayer = this.findClosestPlayer(enemy, zoneId);
             if (closestPlayer && this.calculateDistance(enemy.position, closestPlayer) <= this.ENEMY_AGGRO_RANGE) {
                 enemy.currentTargetId = closestPlayer.id;
                 this.setState(enemy, zoneId, 'CHASING', closestPlayer);
                 return { type: 'MOVE_TO', target: { x: closestPlayer.positionX!, y: closestPlayer.positionY! } };
             }
             // Only Wander if IDLE and no aggro
             if (enemy.anchorX !== undefined && enemy.anchorY !== undefined && enemy.wanderRadius !== undefined) {
                if (Math.random() < this.WANDER_CHANCE) {
                    const angle = Math.random() * Math.PI * 2;
                    const distance = Math.random() * enemy.wanderRadius;
                    const wanderTarget = {
                        x: enemy.anchorX + Math.cos(angle) * distance,
                        y: enemy.anchorY + Math.sin(angle) * distance,
                    };
                    this.setState(enemy, zoneId, 'WANDERING', wanderTarget);
                    return { type: 'MOVE_TO', target: wanderTarget };
                }
             }
        }
        // Continue wandering if already doing so
        if (enemy.aiState === 'WANDERING' && enemy.target) {
             return { type: 'MOVE_TO', target: enemy.target };
        }

        // Default: Remain IDLE
         if (enemy.aiState !== 'IDLE') { this.setState(enemy, zoneId, 'IDLE', null); }
         return { type: 'IDLE' };
    }
  }
    // --- Helper Methods defined within the Class --- 

    // Helper to set state and movement target consistently
    private setState(enemy: EnemyInstance, zoneId: string, newState: string, target: {x: number, y: number} | RuntimeCharacterData | null) {
        if (enemy.aiState !== newState) {
             this.enemyStateStore.setEnemyAiState(zoneId, enemy.id, newState);
             enemy.aiState = newState;
        }
        let targetPos: {x: number, y: number} | null = null;
        if (target && 'positionX' in target) { targetPos = { x: target.positionX!, y: target.positionY! }; }
        else if (target) { targetPos = target as {x: number, y: number} | null; }
        if (enemy.target?.x !== targetPos?.x || enemy.target?.y !== targetPos?.y) {
             this.enemyStateStore.setEnemyTarget(zoneId, enemy.id, targetPos);
             enemy.target = targetPos;
        }
    }

    private findClosestPlayer(enemy: EnemyInstance, zoneId: string): RuntimeCharacterData | undefined {
        let closestCharacter: RuntimeCharacterData | undefined;
        let minDistance = Infinity;
        const playersInZone = this.playerStateStore.getPlayersInZone(zoneId);

        for (const player of playersInZone) {
            for (const character of player.characters) {
                if (character.state === 'dead' || character.currentHealth <= 0 || character.positionX === null || character.positionY === null) {
                    continue;
                }
                const distance = this.calculateDistance(enemy.position, character);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestCharacter = character;
                }
            }
        }
        return closestCharacter;
    }

    private calculateDistance(point1: {x: number, y: number}, point2: {x: number | null, y: number | null} | RuntimeCharacterData ): number {
        let p2x: number | null;
        let p2y: number | null;
        if ('positionX' in point2) { p2x = point2.positionX; p2y = point2.positionY; }
        else { p2x = point2.x; p2y = point2.y; }
        if (p2x === null || p2y === null) return Infinity;
        const dx = point1.x - p2x;
        const dy = point1.y - p2y;
        return Math.sqrt(dx * dx + dy * dy);
    }

} 