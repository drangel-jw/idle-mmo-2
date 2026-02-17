import Phaser from 'phaser';
import { EntityManager } from './EntityManager';
import { ClickMarkerManager } from './ClickMarkerManager';
import { NetworkManager } from '../network/NetworkManager';
import { AbilityManager } from '../game/AbilityManager';
import { EnemySprite } from '../gameobjects/EnemySprite';
import { EventBus } from '../EventBus';

export class InputManager {
    private scene: Phaser.Scene;
    private entityManager: EntityManager;
    private clickMarkerManager: ClickMarkerManager;
    private networkManager: NetworkManager;
    private abilityManager: AbilityManager | null = null;
    private uiSceneRef: any;

    private isTargeting: boolean = false;
    private targetingAbilityId: string | null = null;
    private abilityIndicator: Phaser.GameObjects.Arc | null = null;

    constructor(
        scene: Phaser.Scene,
        entityManager: EntityManager,
        clickMarkerManager: ClickMarkerManager,
        networkManager: NetworkManager,
        uiSceneRef: any
    ) {
        this.scene = scene;
        this.entityManager = entityManager;
        this.clickMarkerManager = clickMarkerManager;
        this.networkManager = networkManager;
        this.uiSceneRef = uiSceneRef;
    }

    setUiSceneRef(ref: any): void {
        this.uiSceneRef = ref;
    }

    setAbilityManager(abilityManager: AbilityManager): void {
        this.abilityManager = abilityManager;
    }

    setupInputListeners(): void {
        this.scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
        this.scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.handlePointerMove, this);

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
            this.handleAbilityKey('Q');
        });
    }

    private handlePointerDown(pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]): void {
        if (!this.networkManager || !this.entityManager.playerCharacters) return;
        if (pointer.button !== 0) return;

        const worldPoint = pointer.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;

        if (this.isTargeting && this.targetingAbilityId && this.abilityManager) {
            this.castAbilityAtTarget(this.targetingAbilityId, worldPoint.x, worldPoint.y);
            this.exitTargetingMode();
            return;
        }

        this.clickMarkerManager.setTarget(worldPoint.x, worldPoint.y);
        this.clickMarkerManager.showClickMarker(worldPoint.x, worldPoint.y);

        let clickedOnActionable = false;
        if (gameObjects.length > 0) {
            const topObject = gameObjects[0];
            if (topObject instanceof EnemySprite && topObject.getData('enemyData')) {
                const enemyId = topObject.getData('enemyData')?.id;
                if (enemyId) {
                    this.networkManager.sendMessage('attackCommand', { targetId: enemyId });
                    clickedOnActionable = true;
                }
            }
        }

        if (!clickedOnActionable) {
            const firstPlayerCharId = Array.from(this.entityManager.playerCharacters.keys())[0];
            if (firstPlayerCharId) {
                this.networkManager.sendMessage('moveCommand', {
                    target: { x: worldPoint.x, y: worldPoint.y }
                });
            }
        }
    }

    private handlePointerMove(pointer: Phaser.Input.Pointer): void {
        if (this.isTargeting && this.abilityIndicator) {
            const worldPoint = pointer.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
            this.abilityIndicator.setPosition(worldPoint.x, worldPoint.y);
        }
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
        this.scene.input.keyboard?.off('keydown-ENTER');
        this.scene.input.keyboard?.off('keydown-Q');

        if (this.abilityIndicator) {
            this.abilityIndicator.destroy();
            this.abilityIndicator = null;
        }
        this.abilityManager = null;
    }
}
