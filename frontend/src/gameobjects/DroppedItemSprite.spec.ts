import { describe, it, expect, vi } from 'vitest';

// Mock Phaser before importing the module under test
vi.mock('phaser', () => {
    class MockSprite {
        scene: any;
        x: number;
        y: number;
        textureKey: string;
        constructor(scene: any, x: number, y: number, texture: string) {
            this.scene = scene;
            this.x = x;
            this.y = y;
            this.textureKey = texture;
        }
        setInteractive() { return this; }
        setDepth() { return this; }
        on() { return this; }
        destroy() {}
    }
    return {
        default: {
            GameObjects: {
                Sprite: MockSprite,
            },
        },
    };
});

// Mock the backend import
vi.mock('../../../backend/src/item/item.types', () => ({
    ItemType: {},
}));

import { DroppedItemSprite, DroppedItemData } from './DroppedItemSprite';

function createMockScene(textureExists: boolean) {
    return {
        textures: {
            exists: vi.fn(() => textureExists),
        },
        add: {
            existing: vi.fn(),
            text: vi.fn(() => ({
                setOrigin: vi.fn(),
                setPosition: vi.fn(),
                setDepth: vi.fn(),
                destroy: vi.fn(),
            })),
        },
        events: {
            emit: vi.fn(),
        },
    } as any;
}

function createItemData(spriteKey: string): DroppedItemData {
    return {
        id: 'item-1',
        itemTemplateId: 'tpl-1',
        itemName: 'Test Sword',
        itemType: 'WEAPON' as any,
        spriteKey,
        position: { x: 100, y: 200 },
        quantity: 1,
    };
}

describe('DroppedItemSprite — texture fallback', () => {
    it('uses spriteKey when texture exists', () => {
        const scene = createMockScene(true);
        const data = createItemData('bronze_sword');
        const sprite = new DroppedItemSprite(scene, data);
        // The sprite's internal texture key should be the one we passed
        expect(scene.textures.exists).toHaveBeenCalledWith('bronze_sword');
        expect((sprite as any).textureKey).toBe('bronze_sword');
    });

    it('falls back to playerPlaceholder when texture is missing', () => {
        const scene = createMockScene(false);
        const data = createItemData('nonexistent_item');
        const sprite = new DroppedItemSprite(scene, data);
        expect(scene.textures.exists).toHaveBeenCalledWith('nonexistent_item');
        expect((sprite as any).textureKey).toBe('playerPlaceholder');
    });
});
