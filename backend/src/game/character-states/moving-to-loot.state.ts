import { Logger } from '@nestjs/common';
import { RuntimeCharacterData } from '../stores/player-state.store';
import { EnemyInstance } from '../interfaces/enemy-instance.interface';
import {
    CharacterStateDependencies,
    ICharacterState,
    StateProcessResult,
} from './character-state.interface';

export class MovingToLootState implements ICharacterState {
    private readonly logger = new Logger(MovingToLootState.name);

    async processTick(
        character: RuntimeCharacterData,
        dependencies: CharacterStateDependencies,
        zoneId: string,
        enemiesInZone: EnemyInstance[],
        siblingCharacters: RuntimeCharacterData[],
        now: number,
        deltaTime: number,
    ): Promise<StateProcessResult> {
        const { playerStateStore, droppedItemStore, inventoryService, ITEM_PICKUP_RANGE_SQ } = dependencies;
        const results: StateProcessResult = {
            combatActions: [],
            enemyHealthUpdates: [],
            targetDied: false,
            pickedUpItemId: null,
        };

        if (character.targetItemId === null || character.targetX === null || character.targetY === null) {
            this.logger.warn(`Character ${character.id} in moving_to_loot state but missing target info. Transitioning to idle.`);
            playerStateStore.setCharacterState(zoneId, character.id, 'idle');
            character.targetItemId = null;
            character.targetX = null;
            character.targetY = null;
            character.commandState = null;
            return results;
        }

        const dxLoot = character.targetX - character.positionX!;
        const dyLoot = character.targetY - character.positionY!;
        const distToLootSq = dxLoot*dxLoot + dyLoot*dyLoot;

        if (distToLootSq <= ITEM_PICKUP_RANGE_SQ) {
            this.logger.debug(`Character ${character.id} reached location for item ${character.targetItemId}. Attempting pickup.`);
            const targetItemId = character.targetItemId;
            const wasLootAreaCommand = character.commandState === 'loot_area';

            const itemToPickup = droppedItemStore.getDroppedItemById(zoneId, targetItemId);
            let pickupSuccess = false;
            if (itemToPickup) {
                try {
                    const addedInventoryItem = await inventoryService.addItemToUser(
                        character.ownerId,
                        itemToPickup.itemTemplateId,
                        itemToPickup.quantity
                    );
                    if (addedInventoryItem) {
                        const removed = droppedItemStore.removeDroppedItem(zoneId, targetItemId);
                        if (removed) {
                            this.logger.log(`Character ${character.id} picked up item ${itemToPickup.itemName} (${targetItemId})`);
                            results.pickedUpItemId = targetItemId;
                            pickupSuccess = true;
                        } else {
                            this.logger.error(`CRITICAL: Added item ${targetItemId} to inventory for char ${character.id} but FAILED to remove it from ground!`);
                        }
                    } else {
                         this.logger.warn(`Character ${character.id} failed to add item ${targetItemId} to inventory (InventoryService returned falsy). Item remains.`);
                    }
                } catch (error) {
                    this.logger.error(`Failed to add item ${targetItemId} to inventory for user ${character.ownerId}: ${error.message}`, error.stack);
                }
            } else {
                this.logger.log(`Item ${targetItemId} no longer exists on ground when char ${character.id} reached it (picked up by other?).`);
            }

            character.targetItemId = null;
            character.targetX = null;
            character.targetY = null;

            if (wasLootAreaCommand) {
                this.logger.debug(`Character ${character.id} finished move_to_loot attempt (success=${pickupSuccess}) during loot_area command. Transitioning back to looting_area.`);
                playerStateStore.setCharacterState(zoneId, character.id, 'looting_area');
            } else {
                this.logger.debug(`Character ${character.id} finished move_to_loot attempt (success=${pickupSuccess}) for single item. Transitioning to idle.`);
                playerStateStore.setCharacterState(zoneId, character.id, 'idle');
                character.commandState = null;
            }
        }

        return results;
    }
}
