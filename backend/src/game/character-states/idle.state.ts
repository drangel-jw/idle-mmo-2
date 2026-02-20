import { Logger } from '@nestjs/common';
import { RuntimeCharacterData } from '../stores/player-state.store';
import { EnemyInstance } from '../interfaces/enemy-instance.interface';
import {
    CharacterStateDependencies,
    ICharacterState,
    StateProcessResult,
} from './character-state.interface';

export class IdleState implements ICharacterState {
    private readonly logger = new Logger(IdleState.name);

    async processTick(
        character: RuntimeCharacterData,
        dependencies: CharacterStateDependencies,
        zoneId: string,
        enemiesInZone: EnemyInstance[],
        siblingCharacters: RuntimeCharacterData[],
        now: number,
        deltaTime: number,
    ): Promise<StateProcessResult> {
        const results: StateProcessResult = {
            combatActions: [],
            enemyHealthUpdates: [],
            targetDied: false,
            pickedUpItemId: null,
        };

        const { playerStateStore, enemyStateStore } = dependencies;

        let closestEnemy: EnemyInstance | null = null;

        // --- Auto-Aggro Scan ---
        if (character.aggroRange > 0) {
            let minDistSq = character.aggroRange * character.aggroRange;
            for (const enemy of enemiesInZone) {
                if (enemy.currentHealth <= 0) continue;
                if (typeof character.positionX !== 'number' || typeof character.positionY !== 'number' ||
                    typeof enemy.position.x !== 'number' || typeof enemy.position.y !== 'number') {
                     this.logger.warn(`Skipping aggro check due to invalid position data for char ${character.id} or enemy ${enemy.id}`);
                     continue;
                }
                const distSq = (character.positionX - enemy.position.x)**2 + (character.positionY - enemy.position.y)**2;
                if (distSq <= minDistSq) {
                    minDistSq = distSq;
                    closestEnemy = enemy;
                }
            }
        }

        // --- Action based on aggro/anchor ---
        if (closestEnemy) {
            this.logger.debug(`Character ${character.id} [${character.name}] auto-aggroed enemy ${closestEnemy.id}. Transitioning to attacking.`);
            const targetEnemy = enemyStateStore.getEnemyInstanceById(zoneId, closestEnemy.id);
            playerStateStore.setAttackTarget(
                zoneId,
                character.id,
                closestEnemy.id,
                !!targetEnemy,
                !!targetEnemy?.isDying,
            );
        } else {
            if (character.anchorX !== null && character.anchorY !== null) {
                const distToAnchorSq = (character.positionX! - character.anchorX)**2 + (character.positionY! - character.anchorY)**2;
                const closeEnoughThresholdSq = 1;
                if (distToAnchorSq > closeEnoughThresholdSq) {
                    this.logger.debug(`Character ${character.id} [${character.name}] is idle away from anchor. Transitioning to moving to return.`);
                    playerStateStore.setMovementTarget(zoneId, character.id, character.anchorX, character.anchorY);
                } else {
                     if (character.commandState && character.targetX === null && character.targetY === null) {
                         this.logger.debug(`Character ${character.id} reached idle state at anchor, clearing command state: ${character.commandState}`);
                         character.commandState = null;
                     }
                }
            }
             if (character.anchorX === null && character.anchorY === null && character.commandState) {
                 this.logger.debug(`Character ${character.id} reached idle state with no anchor, clearing command state: ${character.commandState}`);
                 character.commandState = null;
             }
        }

        return results;
    }
}
