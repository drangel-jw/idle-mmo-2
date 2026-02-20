import { Logger } from '@nestjs/common';
import { RuntimeCharacterData } from '../stores/player-state.store';
import { EnemyInstance } from '../interfaces/enemy-instance.interface';
import {
    CharacterStateDependencies,
    ICharacterState,
    StateProcessResult,
} from './character-state.interface';

export class MovingState implements ICharacterState {
    private readonly logger = new Logger(MovingState.name);

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

        const { playerStateStore } = dependencies;

        if (character.targetX !== null && character.targetY !== null) {
            const dx = character.targetX - character.positionX!;
            const dy = character.targetY - character.positionY!;
            const distSq = dx*dx + dy*dy;
            const closeEnoughThresholdSq = 1;

            if (distSq <= closeEnoughThresholdSq) {
                this.logger.debug(`Character ${character.id} reached target (${character.targetX}, ${character.targetY}). Transitioning to idle.`);
                playerStateStore.setCharacterState(zoneId, character.id, 'idle');
                character.positionX = character.targetX;
                character.positionY = character.targetY;
                character.targetX = null;
                character.targetY = null;

                 const isAtAnchor = character.anchorX !== null && character.anchorY !== null &&
                                    character.positionX === character.anchorX &&
                                    character.positionY === character.anchorY;

                 if (isAtAnchor && character.commandState) {
                    this.logger.debug(`Character ${character.id} reached anchor, clearing command state: ${character.commandState}`);
                    character.commandState = null;
                 } else if (character.commandState !== 'loot_area') {
                     if (character.commandState) {
                         this.logger.debug(`Character ${character.id} reached target, clearing command state: ${character.commandState}`);
                         character.commandState = null;
                     }
                 }
            }
        } else {
             this.logger.warn(`Character ${character.id} in 'moving' state but has no target (targetX/Y are null). Setting idle.`);
             playerStateStore.setCharacterState(zoneId, character.id, 'idle');
             character.targetX = null;
             character.targetY = null;
             character.commandState = null;
        }

        return results;
    }
}
