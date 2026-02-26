import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the animation state mapping logic from handleEntityUpdate.
// Since the method is private, we instantiate with mocks and trigger via the public interface.

// Minimal mocks for dependencies
function createMockScene() {
    return {} as any;
}

function createMockEntityManager() {
    return {
        findSpriteById: vi.fn(),
        playerCharacters: new Map(),
        otherCharacters: new Map(),
        droppedItemSprites: new Map(),
    } as any;
}

function createMockCombatVisualManager() {
    return {
        handleCombatAction: vi.fn(),
        handleEntityDied: vi.fn(),
        handleSpellCast: vi.fn(),
        handleSpellDamage: vi.fn(),
    } as any;
}

function createMockNetworkManager() {
    return {
        sendMessage: vi.fn(),
    } as any;
}

// We need to import CharacterSprite for the instanceof check in handleEntityUpdate
// but we can mock the module
vi.mock('../gameobjects/CharacterSprite', () => {
    class CharacterSprite {
        setAnimation = vi.fn();
        setHealth = vi.fn();
        getMaxHealth = vi.fn(() => 100);
        updateTargetPosition = vi.fn();
        constructor(..._args: any[]) {}
    }
    return { CharacterSprite };
});

vi.mock('../gameobjects/DroppedItemSprite', () => {
    class DroppedItemSprite {}
    return { DroppedItemSprite, DroppedItemData: {} };
});

vi.mock('../EventBus', () => ({
    EventBus: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
    },
}));

vi.mock('../config/game.config', () => ({
    ClientConfig: {
        EXPERIENCE: { BASE_XP: 100, LEVEL_EXPONENT: 1.5 },
    },
}));

import { CharacterSprite } from '../gameobjects/CharacterSprite';
import { EntityUpdateHandler } from './EntityUpdateHandler';

describe('EntityUpdateHandler — animation state mapping', () => {
    let handler: EntityUpdateHandler;
    let entityManager: ReturnType<typeof createMockEntityManager>;
    let sprite: InstanceType<typeof CharacterSprite>;

    beforeEach(() => {
        entityManager = createMockEntityManager();
        sprite = new CharacterSprite() as any;
        entityManager.findSpriteById.mockReturnValue(sprite);

        handler = new EntityUpdateHandler(
            createMockScene(),
            entityManager,
            createMockCombatVisualManager(),
            createMockNetworkManager(),
            null, // uiSceneRef
        );
    });

    function triggerEntityUpdate(state: string) {
        // Access the private method via the registered EventBus callback
        // We call handleEntityUpdate directly by reaching into the instance
        (handler as any).handleEntityUpdate({ id: 'char1', state });
    }

    it('maps "attacking" state to idle animation (not attack)', () => {
        entityManager.playerCharacters.set('char1', sprite);
        triggerEntityUpdate('attacking');
        expect(sprite.setAnimation).toHaveBeenCalledWith('idle', false);
    });

    it('maps "looting_area" state to idle animation', () => {
        entityManager.playerCharacters.set('char1', sprite);
        triggerEntityUpdate('looting_area');
        expect(sprite.setAnimation).toHaveBeenCalledWith('idle', false);
    });

    it('maps "moving" state to walk animation', () => {
        triggerEntityUpdate('moving');
        expect(sprite.setAnimation).toHaveBeenCalledWith('walk', false);
    });

    it('maps "moving_to_loot" state to walk animation', () => {
        triggerEntityUpdate('moving_to_loot');
        expect(sprite.setAnimation).toHaveBeenCalledWith('walk', false);
    });

    it('maps "idle" state to idle animation', () => {
        triggerEntityUpdate('idle');
        expect(sprite.setAnimation).toHaveBeenCalledWith('idle', false);
    });

    it('does NOT call setAnimation for "dead" state', () => {
        triggerEntityUpdate('dead');
        expect(sprite.setAnimation).not.toHaveBeenCalled();
    });

    it('forceRestart is always false', () => {
        triggerEntityUpdate('attacking');
        // The second arg to setAnimation should be false (forceRestart)
        const call = (sprite.setAnimation as any).mock.calls[0];
        expect(call[1]).toBe(false);
    });
});
