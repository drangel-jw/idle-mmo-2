import { Logger } from '@nestjs/common';
import { RuntimeCharacterData } from '../stores/player-state.store';
import { EnemyInstance } from '../interfaces/enemy-instance.interface';
import { DroppedItem } from '../interfaces/dropped-item.interface';
import {
    CharacterStateDependencies,
    ICharacterState,
    StateProcessResult,
} from './character-state.interface';

export class LootingAreaState implements ICharacterState {
    private readonly logger = new Logger(LootingAreaState.name);

    async processTick(
        character: RuntimeCharacterData,
        dependencies: CharacterStateDependencies,
        zoneId: string,
        enemiesInZone: EnemyInstance[],
        siblingCharacters: RuntimeCharacterData[],
        now: number,
        deltaTime: number,
    ): Promise<StateProcessResult> {
        const { playerStateStore, droppedItemStore, ITEM_PICKUP_RANGE_SQ } = dependencies;
        const results: StateProcessResult = {
            combatActions: [],
            enemyHealthUpdates: [],
            targetDied: false,
            pickedUpItemId: null,
        };

        let closestAvailableItem: DroppedItem | null = null;
        let minItemDistSq = character.aggroRange * character.aggroRange;

        const targetedItemIds = new Set<string>();
        for (const sibling of siblingCharacters) {
            if ((sibling.state === 'moving_to_loot' || sibling.state === 'looting_area') && sibling.targetItemId) {
                targetedItemIds.add(sibling.targetItemId);
            }
        }
        if (character.targetItemId) {
             targetedItemIds.add(character.targetItemId);
        }

        const allDroppedItems = droppedItemStore.getDroppedItems(zoneId);

        for (const item of allDroppedItems) {
            if (targetedItemIds.has(item.id)) {
                continue;
            }

            const itemDistSq = (character.positionX! - item.position.x)**2 + (character.positionY! - item.position.y)**2;

            if (itemDistSq <= minItemDistSq) {
                minItemDistSq = itemDistSq;
                closestAvailableItem = item;
            }
        }

        if (closestAvailableItem) {
            this.logger.debug(`Character ${character.id} found nearby item ${closestAvailableItem.id} to loot. Transitioning to moving_to_loot.`);
             playerStateStore.setCharacterState(zoneId, character.id, 'moving_to_loot');
             character.targetItemId = closestAvailableItem.id;
             character.targetX = closestAvailableItem.position.x;
             character.targetY = closestAvailableItem.position.y;

            if (character.commandState !== 'loot_area') {
                 this.logger.warn(`Character ${character.id} entered looting_area state without 'loot_area' commandState? Setting it now.`);
                 character.commandState = 'loot_area';
            }
        } else {
            this.logger.debug(`Character ${character.id} found no nearby items. Command finished. Transitioning to moving (to return to anchor).`);
             if (character.anchorX !== null && character.anchorY !== null) {
                 playerStateStore.setMovementTarget(zoneId, character.id, character.anchorX, character.anchorY);
             } else {
                 this.logger.warn(`Character ${character.id} finished looting area but has no anchor. Going idle.`);
                 playerStateStore.setCharacterState(zoneId, character.id, 'idle');
             }
             character.targetItemId = null;
             character.commandState = null;
        }

        return results;
    }
}
