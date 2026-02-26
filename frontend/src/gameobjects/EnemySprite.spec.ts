import { describe, it, expect, vi } from 'vitest';

// Mock Phaser before importing the module under test
vi.mock('phaser', () => {
    class MockBody {
        setCollideWorldBounds() { return this; }
    }
    class MockSprite {
        scene: any;
        x: number;
        y: number;
        textureKey: string;
        body: MockBody;
        constructor(scene: any, x: number, y: number, texture: string) {
            this.scene = scene;
            this.x = x;
            this.y = y;
            this.textureKey = texture;
            this.body = new MockBody();
        }
        setInteractive() { return this; }
        setDepth() { return this; }
        setData() { return this; }
        on() { return this; }
        destroy() {}
    }
    return {
        default: {
            GameObjects: {
                Sprite: MockSprite,
            },
            Math: {
                Linear: (a: number, b: number, t: number) => a + (b - a) * t,
            },
        },
        GameObjects: {
            Sprite: MockSprite,
        },
        Math: {
            Linear: (a: number, b: number, t: number) => a + (b - a) * t,
        },
    };
});

// Mock HealthBar
vi.mock('./HealthBar', () => ({
    HealthBar: class {
        setVisible() {}
        setHealth() {}
        setPosition() {}
        getMaxHealth() { return 100; }
        destroy() {}
    },
}));

function createMockScene(textureExists: boolean) {
    return {
        textures: {
            exists: vi.fn(() => textureExists),
        },
        add: {
            existing: vi.fn(),
            text: vi.fn(() => ({
                setOrigin: vi.fn(),
                setVisible: vi.fn(),
                setDepth: vi.fn(),
                x: 0,
                y: 0,
                destroy: vi.fn(),
            })),
        },
        physics: {
            add: {
                existing: vi.fn(),
            },
        },
    } as any;
}

import { EnemySprite } from './EnemySprite';

describe('EnemySprite — texture fallback', () => {
    it('uses spriteKey when texture exists', () => {
        const scene = createMockScene(true);
        const enemy = new EnemySprite(scene, 50, 60, 'orc_warrior', 'Orc', { baseHealth: 100 });
        expect(scene.textures.exists).toHaveBeenCalledWith('orc_warrior');
        expect((enemy as any).textureKey).toBe('orc_warrior');
    });

    it('falls back to goblin when texture is missing', () => {
        const scene = createMockScene(false);
        const enemy = new EnemySprite(scene, 50, 60, 'nonexistent_enemy', 'Mystery', { baseHealth: 100 });
        expect(scene.textures.exists).toHaveBeenCalledWith('nonexistent_enemy');
        expect((enemy as any).textureKey).toBe('goblin');
    });
});
