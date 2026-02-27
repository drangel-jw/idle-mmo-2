import { Logger } from '@nestjs/common';
import { RuntimeCharacterData } from '../stores/player-state.store';
import { EnemyInstance } from '../interfaces/enemy-instance.interface';
import { CombatResult } from '../interfaces/combat.interface';
import {
    CharacterStateDependencies,
    ICharacterState,
    StateProcessResult,
} from './character-state.interface';
import { GameConfig } from '../../common/config/game.config';

export class AttackingState implements ICharacterState {
    private readonly logger = new Logger(AttackingState.name);

    async processTick(
        character: RuntimeCharacterData,
        dependencies: CharacterStateDependencies,
        zoneId: string,
        enemiesInZone: EnemyInstance[],
        siblingCharacters: RuntimeCharacterData[],
        now: number,
        deltaTime: number,
    ): Promise<StateProcessResult> {
        const { playerStateStore, enemyStateStore, combatService, enemyService, characterService } = dependencies;
        const results: StateProcessResult = {
            combatActions: [],
            enemyHealthUpdates: [],
            targetDied: false,
            pickedUpItemId: null,
        };

        if (!character.attackTargetId) {
            this.logger.warn(`Character ${character.id} in attacking state but has no attackTargetId. Transitioning to idle.`);
            playerStateStore.setCharacterState(zoneId, character.id, 'idle');
            character.targetX = null;
            character.targetY = null;
            return results;
        }

        const targetEnemy = enemyStateStore.getEnemyInstanceById(zoneId, character.attackTargetId);

        if (!targetEnemy || targetEnemy.currentHealth <= 0 || targetEnemy.isDying) {
            this.logger.debug(`Character ${character.id}'s target ${character.attackTargetId} is dead, dying, or gone. Transitioning to idle.`);
            character.attackTargetId = null;
            playerStateStore.setCharacterState(zoneId, character.id, 'idle');
            character.targetX = null;
            character.targetY = null;
            return results;
        }

        const distToTargetSq = (character.positionX! - targetEnemy.position.x)**2 + (character.positionY! - targetEnemy.position.y)**2;
        const attackRangeSq = character.attackRange * character.attackRange;

        if (distToTargetSq <= attackRangeSq) {
            if (character.targetX !== null || character.targetY !== null) {
                character.targetX = null;
                character.targetY = null;
            }

            if (now >= character.lastAttackTime + character.attackSpeed) {
                const combatResult: CombatResult = await combatService.handleAttack(character, targetEnemy, zoneId);
                character.lastAttackTime = now;

                results.combatActions.push({
                    attackerId: character.id,
                    targetId: targetEnemy.id,
                    damage: combatResult.damageDealt,
                    type: 'attack',
                });
                results.enemyHealthUpdates.push({
                    id: targetEnemy.id,
                    health: combatResult.targetCurrentHealth,
                });

                if (combatResult.targetDied) {
                    this.logger.log(`Enemy ${targetEnemy.id} (Template: ${targetEnemy.templateId}) died from attack by Character ${character.id} (${character.name}). Granting XP and transitioning to idle.`);
                    results.targetDied = true;

                    await this._grantXpToParty(character, targetEnemy, dependencies, zoneId);

                    character.attackTargetId = null;
                    playerStateStore.setCharacterState(zoneId, character.id, 'idle');
                }
            }

        } else {
            this.logger.debug(`Character ${character.id} is out of attack range for ${targetEnemy.id}. Setting target and transitioning to moving.`);
            if (typeof targetEnemy.position.x === 'number' && typeof targetEnemy.position.y === 'number') {
                 playerStateStore.setMovementTarget(zoneId, character.id, targetEnemy.position.x, targetEnemy.position.y);
                 character.attackTargetId = targetEnemy.id;
             } else {
                 this.logger.error(`[AttackingState] Target enemy ${targetEnemy.id} has invalid position data. Cannot set movement target.`);
                 playerStateStore.setCharacterState(zoneId, character.id, 'idle');
                 character.attackTargetId = null;
             }
        }

        return results;
    }

    private async _grantXpToParty(
        killerCharacter: RuntimeCharacterData,
        targetEnemy: EnemyInstance,
        dependencies: CharacterStateDependencies,
        zoneId: string,
    ): Promise<void> {
        const { playerStateStore, enemyService, characterService } = dependencies;
        try {
            const enemyTemplate = await enemyService.findOne(targetEnemy.templateId);
            if (enemyTemplate && enemyTemplate.xpReward > 0) {
                const partyMembers = playerStateStore.getPlayerCharactersInZone(
                    zoneId,
                    killerCharacter.ownerId,
                );
                if (partyMembers.length > 0) {
                    this.logger.log(
                        `Granting ${enemyTemplate.xpReward} XP to ${partyMembers.length} party member(s) (Owner: ${killerCharacter.ownerId}) for killing Enemy ${targetEnemy.id}`,
                    );
                    for (const member of partyMembers) {
                        if (member.state !== 'dead') {
                            const scaledXp = this._calculateScaledXp(enemyTemplate.xpReward, member.level, targetEnemy.level);
                            if (scaledXp > 0) {
                                await characterService.addXp(member.id, scaledXp);
                            } else {
                                this.logger.debug(
                                    `Skipping XP grant for member ${member.id} (Lv ${member.level}) — enemy Lv ${targetEnemy.level} is trivial`,
                                );
                            }
                        } else if (member.state === 'dead') {
                            this.logger.debug(
                                `Skipping XP grant for dead party member ${member.id}`,
                            );
                        }
                    }
                } else {
                    this.logger.warn(`Could not find party members for player ${killerCharacter.ownerId} in zone ${zoneId} to grant XP.`);
                }
            } else if (enemyTemplate) {
                this.logger.debug(`Enemy template ${targetEnemy.templateId} has no XP reward.`);
            } else {
                this.logger.warn(`Could not find enemy template ${targetEnemy.templateId} to grant XP.`);
            }
        } catch (error) {
            this.logger.error(`Failed to grant XP to character ${killerCharacter.id} party after killing enemy ${targetEnemy.id}: ${error.message}`, error.stack);
        }
    }

    private _calculateScaledXp(baseXp: number, characterLevel: number, enemyLevel: number): number {
        const { FULL_XP_LEVEL_DIFF, ZERO_XP_LEVEL_DIFF, MIN_MULTIPLIER } = GameConfig.EXPERIENCE.XP_SCALING;
        const levelDiff = characterLevel - enemyLevel;

        if (levelDiff <= FULL_XP_LEVEL_DIFF) {
            return baseXp; // At-level or underleveled → full XP
        }
        if (levelDiff >= ZERO_XP_LEVEL_DIFF) {
            return Math.floor(baseXp * MIN_MULTIPLIER); // Trivial → zero (or min) XP
        }

        // Linear falloff between FULL_XP_LEVEL_DIFF and ZERO_XP_LEVEL_DIFF
        const range = ZERO_XP_LEVEL_DIFF - FULL_XP_LEVEL_DIFF;
        const stepsIntoRange = levelDiff - FULL_XP_LEVEL_DIFF;
        const multiplier = 1.0 - (stepsIntoRange / range);
        return Math.floor(baseXp * multiplier);
    }
}
