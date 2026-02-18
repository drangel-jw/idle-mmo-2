import { Injectable, Logger } from '@nestjs/common';
import { DroppedItem } from '../interfaces/dropped-item.interface';

@Injectable()
export class DroppedItemStore {
    private readonly logger = new Logger(DroppedItemStore.name);
    private items: Map<string, Map<string, DroppedItem>> = new Map();

    ensureZone(zoneId: string): void {
        if (!this.items.has(zoneId)) {
            this.items.set(zoneId, new Map());
        }
    }

    addDroppedItem(zoneId: string, item: DroppedItem): boolean {
        const zoneItems = this.items.get(zoneId);
        if (!zoneItems) {
            this.logger.warn(`Cannot add dropped item: Zone ${zoneId} not found.`);
            return false;
        }
        zoneItems.set(item.id, item);
        return true;
    }

    removeDroppedItem(zoneId: string, itemId: string): DroppedItem | null {
        const zoneItems = this.items.get(zoneId);
        if (!zoneItems) return null;
        const item = zoneItems.get(itemId);
        if (!item) return null;
        zoneItems.delete(itemId);
        return item;
    }

    getDroppedItems(zoneId: string): DroppedItem[] {
        const zoneItems = this.items.get(zoneId);
        return zoneItems ? Array.from(zoneItems.values()) : [];
    }

    getDroppedItemById(zoneId: string, itemId: string): DroppedItem | undefined {
        return this.items.get(zoneId)?.get(itemId);
    }
}
