import Phaser from 'phaser';
import { NetworkManager } from '../network/NetworkManager';
import { EventBus } from '../EventBus';
import UIScene from './UIScene';
import { ZoneCharacterState } from '../types/zone.types';
import { BackgroundManager } from '../gameobjects/BackgroundManager';
import { AbilityManager } from '../game/AbilityManager';
import { ClientConfig } from '../config/game.config';
import { EntityManager } from '../managers/EntityManager';
import { EntityUpdateHandler } from '../managers/EntityUpdateHandler';
import { CombatVisualManager } from '../managers/CombatVisualManager';
import { ClickMarkerManager } from '../managers/ClickMarkerManager';
import { InputManager } from '../managers/InputManager';

interface EnemySpawnData {
    id: string;
    templateId: string;
    zoneId: string;
    name: string;
    currentHealth: number;
    baseHealth?: number;
    position: { x: number; y: number };
}

export default class GameScene extends Phaser.Scene {
    networkManager!: NetworkManager;
    selectedPartyData: any[] = [];
    private uiSceneRef: UIScene | null = null;
    private backgroundManager: BackgroundManager | null = null;
    private abilityManager: AbilityManager | null = null;

    // Managers
    private entityManager!: EntityManager;
    private entityUpdateHandler!: EntityUpdateHandler;
    private combatVisualManager!: CombatVisualManager;
    private clickMarkerManager!: ClickMarkerManager;
    private inputManager!: InputManager;

    constructor() {
        super('GameScene');
    }

    init(data: { selectedParty?: any[], zoneState?: any[], enemyState?: any[], backgroundData?: any }) {
        this.selectedPartyData = data?.selectedParty || [];
        this.networkManager = NetworkManager.getInstance();

        if (data?.backgroundData?.backgroundManager) {
            this.backgroundManager = data.backgroundData.backgroundManager;
            (this.backgroundManager as any).scene = this;
        }
    }

    preload() {
        this.load.image('playerPlaceholder', 'assets/sprites/player_sprite.png');
        this.load.image('clickMarker', 'assets/ui/click_marker.png');
        this.load.image('goblin', 'assets/sprites/goblin.png');
        this.load.image('spider', 'assets/sprites/spider.png');

        const classesToLoad = ['fighter', 'wizard', 'archer', 'priest'];
        const frameConfig = { frameWidth: 100, frameHeight: 100 };

        classesToLoad.forEach(className => {
            const basePath = `assets/sprites/characters/${className}/`;
            const states = { idle: 'idle.png', walk: 'walk.png', attack: 'attack.png' };

            for (const state in states) {
                const fileName = states[state as keyof typeof states];
                const key = `${className}_${state}`;
                this.load.spritesheet(key, basePath + fileName, frameConfig);
            }
        });
    }

    create() {
        if (!this.networkManager.isConnected()) {
            this.handleDisconnectError('Connection lost. Please log in again.');
            return;
        }

        // Setup world
        this.cameras.main.setBackgroundColor('#5a8f37');
        const worldWidth = ClientConfig.WORLD.WIDTH;
        const worldHeight = ClientConfig.WORLD.HEIGHT;
        this.physics.world.setBounds(0, 0, worldWidth, worldHeight);
        this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);

        // Background
        if (!this.backgroundManager) {
            this.backgroundManager = new BackgroundManager(this, worldWidth, worldHeight);
            this.backgroundManager.initialize();
        }

        // Initialize managers
        this.entityManager = new EntityManager(this);
        this.entityManager.initializePlayerClassMap(this.selectedPartyData);

        this.combatVisualManager = new CombatVisualManager(this, this.entityManager);
        this.clickMarkerManager = new ClickMarkerManager(this);

        // Launch UI Scene
        this.scene.launch('UIScene', { selectedParty: this.selectedPartyData });
        this.uiSceneRef = this.scene.get('UIScene') as UIScene;

        this.entityUpdateHandler = new EntityUpdateHandler(
            this, this.entityManager, this.combatVisualManager,
            this.networkManager, this.uiSceneRef
        );

        this.inputManager = new InputManager(
            this, this.entityManager, this.clickMarkerManager,
            this.networkManager, this.uiSceneRef
        );

        // Register event listeners
        EventBus.on('network-disconnect', this.handleDisconnectError, this);
        this.entityUpdateHandler.registerEventListeners();
        this.inputManager.setupInputListeners();

        // Initialize abilities
        this.abilityManager = new AbilityManager(this.networkManager);
        this.inputManager.setAbilityManager(this.abilityManager);
        this.abilityManager.loadAbilities();

        // Load initial entities
        this.initializeEntities();
    }

    private initializeEntities(): void {
        const initData = this.scene.settings.data as any;

        const loadEntities = (zoneState: any[], enemyState: any[]) => {
            this.selectedPartyData.forEach(charData => {
                const startX = charData.positionX ?? 150;
                const startY = charData.positionY ?? 150;
                this.entityManager.createOrUpdateCharacterSprite(charData, true, startX, startY);
            });

            zoneState.forEach((charData: any) => {
                this.entityManager.createOrUpdateCharacterSprite(charData, false);
            });

            enemyState.forEach((enemyData: any) => {
                this.entityManager.createEnemySprite(enemyData);
            });

            const firstPlayerChar = Array.from(this.entityManager.playerCharacters.values())[0];
            if (firstPlayerChar) {
                this.cameras.main.startFollow(firstPlayerChar, true, ClientConfig.CAMERA.FOLLOW_LERP, ClientConfig.CAMERA.FOLLOW_LERP);
                this.cameras.main.setZoom(ClientConfig.CAMERA.ZOOM);
            }

            this.networkManager.sendMessage('requestInventory');
        };

        if (initData && initData.zoneState && initData.enemyState) {
            loadEntities(initData.zoneState, initData.enemyState);
        } else {
            const zoneId = 'startZone';
            this.networkManager.sendMessage('enterZone', { zoneId }, (response: { success: boolean; zoneState?: ZoneCharacterState[]; enemyState?: EnemySpawnData[]; message?: string }) => {
                if (response && response.success) {
                    loadEntities(response.zoneState || [], response.enemyState || []);
                } else {
                    this.handleDisconnectError(`Failed to enter zone: ${response?.message}`);
                }
            });
        }
    }

    update(time: number, delta: number) {
        this.entityManager.update(time, delta);

        if (this.backgroundManager && this.backgroundManager.isReady()) {
            const camera = this.cameras.main;
            this.backgroundManager.update(
                camera.scrollX + camera.width / 2,
                camera.scrollY + camera.height / 2,
                camera.width, camera.height
            );
        }

        this.combatVisualManager.cleanupOldAttacks();

        if (this.clickMarkerManager.hasActiveMarker && this.entityManager.playerCharacters.size > 0) {
            const avg = this.entityManager.getPlayerPositionAverage();
            this.clickMarkerManager.checkArrival(avg.x, avg.y);
        }
    }

    private handleDisconnectError(reason: string | any): void {
        const message = typeof reason === 'string' ? reason : 'Connection error.';
        if (this.scene.isActive()) {
            this.cleanupScene();
            alert(`Disconnected: ${message}`);
            this.scene.start('LoginScene');
        }
    }

    private cleanupScene(): void {
        EventBus.off('network-disconnect', this.handleDisconnectError, this);
        this.entityUpdateHandler?.removeEventListeners();
        this.inputManager?.destroy();
        this.entityManager?.destroy();
        this.combatVisualManager?.destroy();
        this.clickMarkerManager?.destroy();

        if (this.backgroundManager) {
            this.backgroundManager.destroy();
            this.backgroundManager = null;
        }

        this.uiSceneRef = null;
        this.abilityManager = null;
        this.scene.stop('UIScene');
    }

    // Phaser lifecycle — called when scene is shut down
    shutdown() {
        this.cleanupScene();
    }
}
