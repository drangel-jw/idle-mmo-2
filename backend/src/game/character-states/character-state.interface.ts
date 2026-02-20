import { RuntimeCharacterData } from '../stores/player-state.store';
import { PlayerStateStore } from '../stores/player-state.store';
import { EnemyStateStore } from '../stores/enemy-state.store';
import { DroppedItemStore } from '../stores/dropped-item.store';
import { CombatService } from '../combat.service';
import { InventoryService } from '../../inventory/inventory.service';
import { CharacterService } from '../../character/character.service';
import { EnemyService } from '../../enemy/enemy.service';
import { EnemyInstance } from '../interfaces/enemy-instance.interface';
import { DroppedItem } from '../interfaces/dropped-item.interface';

// Structure for dependencies needed by state logic
export interface CharacterStateDependencies {
    playerStateStore: PlayerStateStore;
    enemyStateStore: EnemyStateStore;
    droppedItemStore: DroppedItemStore;
    combatService: CombatService;
    inventoryService: InventoryService;
    characterService: CharacterService;
    enemyService: EnemyService;
    ITEM_PICKUP_RANGE_SQ: number;
}

// Structure for the results returned by a state's processing
export interface StateProcessResult {
    combatActions: any[];
    enemyHealthUpdates: Array<{ id: string; health: number }>;
    targetDied: boolean;
    pickedUpItemId: string | null;
}

export interface ICharacterState {
    processTick(
        character: RuntimeCharacterData,
        dependencies: CharacterStateDependencies,
        zoneId: string,
        enemiesInZone: EnemyInstance[],
        siblingCharacters: RuntimeCharacterData[],
        now: number,
        deltaTime: number,
    ): Promise<StateProcessResult>;
}
