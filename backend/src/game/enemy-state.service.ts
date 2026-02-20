import { Injectable, Logger } from '@nestjs/common';
import { CombatService } from './combat.service';
import { AIService } from './ai.service';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { RuntimeCharacterData } from './stores/player-state.store';
import { PlayerStateStore } from './stores/player-state.store';
import { EnemyStateStore } from './stores/enemy-state.store';
import { CombatResult } from './interfaces/combat.interface';

// Define structure for results returned by processing an enemy tick
export interface EnemyTickResult {
    enemyData: EnemyInstance;
    combatActions: any[];
    characterHealthUpdates: Array<{ id: string, health: number }>;
    targetDied: boolean;
    aiActionType: string;
}

@Injectable()
export class EnemyStateService {
    private readonly logger = new Logger(EnemyStateService.name);

    constructor(
        private readonly playerStateStore: PlayerStateStore,
        private readonly enemyStateStore: EnemyStateStore,
        private combatService: CombatService,
        private aiService: AIService,
    ) {}

    async processEnemyTick(
        enemy: EnemyInstance,
        zoneId: string,
        now: number,
        deltaTime: number,
    ): Promise<EnemyTickResult> {

        const results: EnemyTickResult = {
            enemyData: enemy,
            combatActions: [],
            characterHealthUpdates: [],
            targetDied: false,
            aiActionType: 'NONE',
        };

        const action = this.aiService.updateEnemyAI(enemy, zoneId);
        results.aiActionType = action.type;

        switch (action.type) {
            case 'ATTACK':
                const targetCharacterState: RuntimeCharacterData | undefined = this.playerStateStore.getCharacterStateById(zoneId, action.targetEntityId);

                if (targetCharacterState && targetCharacterState.currentHealth > 0 && targetCharacterState.state !== 'dead') {
                    const combatResult: CombatResult = await this.combatService.handleAttack(enemy, targetCharacterState, zoneId);

                    results.combatActions.push({ attackerId: enemy.id, targetId: action.targetEntityId, damage: combatResult.damageDealt, type: 'attack' });
                    results.characterHealthUpdates.push({ id: action.targetEntityId, health: combatResult.targetCurrentHealth });

                    if (combatResult.targetDied) {
                        results.targetDied = true;
                    }
                } else {
                     this.logger.warn(`Enemy ${enemy.id} AI tried to attack invalid/dead target ${action.targetEntityId}. Current AI state: ${enemy.aiState}. Target state: ${targetCharacterState?.state}, health: ${targetCharacterState?.currentHealth}`);
                     this.enemyStateStore.setEnemyAiState(zoneId, enemy.id, 'IDLE');
                     enemy.target = null;
                     this.enemyStateStore.setEnemyTarget(zoneId, enemy.id, null);
                }
                break;

            case 'MOVE_TO':
                 if (!enemy.target || enemy.target.x !== action.target.x || enemy.target.y !== action.target.y) {
                     this.enemyStateStore.setEnemyTarget(zoneId, enemy.id, action.target);
                     enemy.target = action.target;
                 }
                break;

            case 'IDLE':
                if (enemy.target) {
                    this.enemyStateStore.setEnemyTarget(zoneId, enemy.id, null);
                    enemy.target = null;
                }
                break;
        }

        results.enemyData = enemy;
        return results;
    }
}
