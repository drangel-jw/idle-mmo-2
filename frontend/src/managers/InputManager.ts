import Phaser from 'phaser';
import { EntityManager } from './EntityManager';
import { ClickMarkerManager } from './ClickMarkerManager';
import { NetworkManager } from '../network/NetworkManager';
import { AbilityManager } from '../game/AbilityManager';
import { SelectionManager } from './SelectionManager';
import { EnemySprite } from '../gameobjects/EnemySprite';
import { CharacterSprite } from '../gameobjects/CharacterSprite';
import { ClientConfig } from '../config/game.config';
import { EventBus } from '../EventBus';

export class InputManager {
    private scene: Phaser.Scene;
    private entityManager: EntityManager;
    private clickMarkerManager: ClickMarkerManager;
    private networkManager: NetworkManager;
    private selectionManager: SelectionManager;
    private abilityManager: AbilityManager | null = null;
    private uiSceneRef: any;

    private isTargeting: boolean = false;
    private targetingAbilityId: string | null = null;
    private abilityIndicator: Phaser.GameObjects.Arc | null = null;

    // Drag state for box-select
    private dragStartWorld: { x: number; y: number } | null = null;
    private isDragging: boolean = false;
    private pointerDownObjects: Phaser.GameObjects.GameObject[] = [];

    constructor(
        scene: Phaser.Scene,
        entityManager: EntityManager,
        clickMarkerManager: ClickMarkerManager,
        networkManager: NetworkManager,
        uiSceneRef: any,
        selectionManager: SelectionManager
    ) {
        this.scene = scene;
        this.entityManager = entityManager;
        this.clickMarkerManager = clickMarkerManager;
        this.networkManager = networkManager;
        this.uiSceneRef = uiSceneRef;
        this.selectionManager = selectionManager;
    }

    setUiSceneRef(ref: any): void {
        this.uiSceneRef = ref;
    }

    setAbilityManager(abilityManager: AbilityManager): void {
        this.abilityManager = abilityManager;
    }

    private isChatFocused(): boolean {
        const chatInput = this.uiSceneRef?.getChatInputElement();
        return document.activeElement === chatInput;
    }

    setupInputListeners(): void {
        this.scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
        this.scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.handlePointerMove, this);
        this.scene.input.on(Phaser.Input.Events.POINTER_UP, this.handlePointerUp, this);

        // Prevent browser context menu on the game canvas
        const canvas = this.scene.game.canvas;
        canvas.oncontextmenu = (e) => e.preventDefault();

        this.scene.input.keyboard?.on('keydown-ENTER', (event: KeyboardEvent) => {
            const chatInput = this.uiSceneRef?.getChatInputElement();
            if (document.activeElement === chatInput) {
                return;
            } else {
                EventBus.emit('focus-chat-input');
                event.stopPropagation();
            }
        });

        this.scene.input.keyboard?.on('keydown-Q', () => {
            if (this.isChatFocused()) return;
            this.handleAbilityKey('Q');
        });

        // Selection keys: 1, 2, 3, backtick
        this.scene.input.keyboard?.on('keydown-ONE', () => {
            if (this.isChatFocused()) return;
            this.selectionManager.selectByIndex(0);
        });
        this.scene.input.keyboard?.on('keydown-TWO', () => {
            if (this.isChatFocused()) return;
            this.selectionManager.selectByIndex(1);
        });
        this.scene.input.keyboard?.on('keydown-THREE', () => {
            if (this.isChatFocused()) return;
            this.selectionManager.selectByIndex(2);
        });
        this.scene.input.keyboard?.on('keydown-BACKTICK', () => {
            if (this.isChatFocused()) return;
            this.selectionManager.selectAll();
        });
    }

    private handlePointerDown(pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]): void {
        if (!this.networkManager || !this.entityManager.playerCharacters) return;

        if (pointer.button === 0) {
            // Left click
            const worldPoint = pointer.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;

            // Ability targeting takes priority
            if (this.isTargeting && this.targetingAbilityId && this.abilityManager) {
                this.castAbilityAtTarget(this.targetingAbilityId, worldPoint.x, worldPoint.y);
                this.exitTargetingMode();
                return;
            }

            // Start potential drag for box-select
            this.dragStartWorld = { x: worldPoint.x, y: worldPoint.y };
            this.isDragging = false;
            this.pointerDownObjects = gameObjects;
        } else if (pointer.button === 2) {
            // Right click — commands
            this.handleRightClick(pointer, gameObjects);
        }
    }

    private handlePointerMove(pointer: Phaser.Input.Pointer): void {
        // Ability targeting indicator
        if (this.isTargeting && this.abilityIndicator) {
            const worldPoint = pointer.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
            this.abilityIndicator.setPosition(worldPoint.x, worldPoint.y);
        }

        // Box-select drag (left button held)
        if (pointer.isDown && pointer.button === 0 && this.dragStartWorld) {
            const worldPoint = pointer.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
            const dx = worldPoint.x - this.dragStartWorld.x;
            const dy = worldPoint.y - this.dragStartWorld.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > ClientConfig.SELECTION.MIN_DRAG_PX) {
                this.isDragging = true;
                this.selectionManager.drawBoxSelect(
                    this.dragStartWorld.x, this.dragStartWorld.y,
                    worldPoint.x, worldPoint.y
                );
            }
        }
    }

    private handlePointerUp(pointer: Phaser.Input.Pointer): void {
        if (pointer.button !== 0) return;

        if (this.isDragging && this.dragStartWorld) {
            // Complete box select
            const worldPoint = pointer.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
            this.selectionManager.selectInRect(
                this.dragStartWorld.x, this.dragStartWorld.y,
                worldPoint.x, worldPoint.y
            );
            this.selectionManager.clearBoxSelect();
        } else if (this.dragStartWorld) {
            // Was a click (no drag) — check if clicked on own character
            let clickedOwnChar = false;
            for (const obj of this.pointerDownObjects) {
                if (obj instanceof CharacterSprite && obj.isPlayerCharacter) {
                    this.selectionManager.setSelection([obj.characterId]);
                    clickedOwnChar = true;
                    break;
                }
            }
            // If clicked on nothing / enemy / ground with left click — no action (keeps current selection)
        }

        // Reset drag state
        this.dragStartWorld = null;
        this.isDragging = false;
        this.pointerDownObjects = [];
    }

    private handleRightClick(pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]): void {
        const worldPoint = pointer.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
        const characterIds = this.selectionManager.getSelectedIds();

        if (characterIds.length === 0) return;

        // Check if right-clicked on an enemy
        for (const obj of gameObjects) {
            if (obj instanceof EnemySprite && obj.getData('enemyData')) {
                const enemyId = obj.getData('enemyData')?.id;
                if (enemyId) {
                    this.networkManager.sendMessage('attackCommand', {
                        targetId: enemyId,
                        characterIds,
                    });
                    return;
                }
            }
        }

        // Right-click on ground — move selected characters
        this.clickMarkerManager.setTarget(worldPoint.x, worldPoint.y);
        this.clickMarkerManager.showClickMarker(worldPoint.x, worldPoint.y);

        this.networkManager.sendMessage('moveCommand', {
            target: { x: worldPoint.x, y: worldPoint.y },
            characterIds,
        });
    }

    private handleAbilityKey(key: string): void {
        if (!this.abilityManager) return;

        if (key === 'Q') {
            const abilities = this.abilityManager.getAllAbilities();
            const rainOfArrows = abilities.find(ability => ability.name === 'Rain of Arrows');

            if (rainOfArrows && this.abilityManager.canCastAbility(rainOfArrows.id)) {
                this.enterTargetingMode(rainOfArrows.id);
            }
        }
    }

    private enterTargetingMode(abilityId: string): void {
        if (!this.abilityManager) return;
        const ability = this.abilityManager.getAbility(abilityId);
        if (!ability) return;

        this.isTargeting = true;
        this.targetingAbilityId = abilityId;

        if (ability.radius) {
            this.createAbilityIndicator(ability.radius);
        }
    }

    private exitTargetingMode(): void {
        this.isTargeting = false;
        this.targetingAbilityId = null;

        if (this.abilityIndicator) {
            this.abilityIndicator.destroy();
            this.abilityIndicator = null;
        }
    }

    private createAbilityIndicator(radius: number): void {
        if (this.abilityIndicator) {
            this.abilityIndicator.destroy();
        }
        this.abilityIndicator = this.scene.add.circle(0, 0, radius, 0xff0000, 0.3);
        this.abilityIndicator.setStrokeStyle(2, 0xff0000, 1);
        this.abilityIndicator.setDepth(10);
    }

    private castAbilityAtTarget(abilityId: string, targetX: number, targetY: number): void {
        if (!this.abilityManager) return;
        this.abilityManager.castAbility(abilityId, targetX, targetY);
    }

    destroy(): void {
        this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
        this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.handlePointerMove, this);
        this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.handlePointerUp, this);
        this.scene.input.keyboard?.off('keydown-ENTER');
        this.scene.input.keyboard?.off('keydown-Q');
        this.scene.input.keyboard?.off('keydown-ONE');
        this.scene.input.keyboard?.off('keydown-TWO');
        this.scene.input.keyboard?.off('keydown-THREE');
        this.scene.input.keyboard?.off('keydown-BACKTICK');

        // Restore context menu
        const canvas = this.scene.game.canvas;
        canvas.oncontextmenu = null;

        if (this.abilityIndicator) {
            this.abilityIndicator.destroy();
            this.abilityIndicator = null;
        }
        this.abilityManager = null;
    }
}
