import { Test, TestingModule } from '@nestjs/testing';
import { GameLoopService } from './game-loop.service';
import { ZoneService } from './zone.service';
import { PlayerStateStore, PlayerInZone } from './stores/player-state.store';
import { EnemyStateStore } from './stores/enemy-state.store';
import { NestStateStore } from './stores/nest-state.store';
import { DroppedItemStore } from './stores/dropped-item.store';
import { SpellQueueStore } from './stores/spell-queue.store';
import { CombatService } from './combat.service';
import { AIService } from './ai.service';
import { CharacterStateService } from './character-state.service';
import { MovementService } from './movement.service';
import { EnemyStateService } from './enemy-state.service';
import { SpawningService } from './spawning.service';
import { BroadcastService } from './broadcast.service';
import { LootService } from '../loot/loot.service';
import { InventoryService } from '../inventory/inventory.service';
import { AbilityService } from '../abilities/ability.service';
import { CharacterService } from '../character/character.service';
import { GameConfig } from '../common/config/game.config';
import { User } from '../user/user.entity';
import { Server } from 'socket.io';
import { createMockUser, createMockRuntimeChar } from './test-helpers/factories';

/**
 * Tests for the periodic position save logic inside GameLoopService.tickGameLoop().
 *
 * Since tickGameLoop is private, we test it indirectly through startLoop and
 * manual timer control, or by exposing it via a type assertion.
 */
describe('GameLoopService - periodic position save', () => {
  let service: GameLoopService;

  const mockUser = createMockUser();

  const mockZoneService = { getActiveZoneIds: jest.fn().mockReturnValue([]), createZone: jest.fn() };
  const mockPlayerStateStore = {
    getPlayersInZone: jest.fn().mockReturnValue([]),
    getPlayerCharacters: jest.fn(),
    getCharacterStateById: jest.fn(),
    ensureZone: jest.fn(),
  };
  const mockEnemyStateStore = {
    getZoneEnemies: jest.fn().mockReturnValue([]),
    getEnemyInstanceById: jest.fn(),
    ensureZone: jest.fn(),
    updateEnemyPosition: jest.fn(),
    setEnemyTarget: jest.fn(),
    setEnemyAiState: jest.fn(),
    removeEnemy: jest.fn(),
  };
  const mockNestStateStore = { getZoneNests: jest.fn().mockReturnValue([]) };
  const mockDroppedItemStore = {
    getDroppedItems: jest.fn().mockReturnValue([]),
    ensureZone: jest.fn(),
    removeDroppedItem: jest.fn(),
  };
  const mockSpellQueueStore = {
    getAndClearQueuedSpells: jest.fn().mockReturnValue([]),
    ensureZone: jest.fn(),
  };
  const mockCombatService = { handleAttack: jest.fn(), handleSpellDamage: jest.fn() };
  const mockAIService = { updateEnemyAI: jest.fn() };
  const mockCharacterStateService = {
    processCharacterTick: jest.fn().mockResolvedValue({
      diedThisTick: false,
      respawnedThisTick: false,
      combatActions: [],
      enemyHealthUpdates: [],
      characterData: {},
      pickedUpItemId: null,
    }),
  };
  const mockMovementService = {
    simulateMovement: jest.fn().mockReturnValue({ newPosition: { x: 0, y: 0 }, reachedTarget: true }),
  };
  const mockEnemyStateService = {
    processEnemyTick: jest.fn().mockResolvedValue({
      combatActions: [],
      characterHealthUpdates: [],
      targetDied: false,
    }),
  };
  const mockSpawningService = { processNestSpawns: jest.fn().mockResolvedValue([]) };
  const mockBroadcastService = {
    setServerInstance: jest.fn(),
    flushZoneEvents: jest.fn(),
    queueEntityUpdate: jest.fn(),
    queueCombatAction: jest.fn(),
    queueDeath: jest.fn(),
    queueSpawn: jest.fn(),
    queueItemPickedUp: jest.fn(),
    queueItemDespawned: jest.fn(),
    queueSpellCast: jest.fn(),
    queueSpellDamage: jest.fn(),
    queueCharacterStateChange: jest.fn(),
  };
  const mockLootService = {};
  const mockInventoryService = { getUserInventory: jest.fn() };
  const mockAbilityService = { findById: jest.fn() };
  const mockCharacterService = {
    saveCharacterPositions: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameLoopService,
        { provide: ZoneService, useValue: mockZoneService },
        { provide: PlayerStateStore, useValue: mockPlayerStateStore },
        { provide: EnemyStateStore, useValue: mockEnemyStateStore },
        { provide: NestStateStore, useValue: mockNestStateStore },
        { provide: DroppedItemStore, useValue: mockDroppedItemStore },
        { provide: SpellQueueStore, useValue: mockSpellQueueStore },
        { provide: CombatService, useValue: mockCombatService },
        { provide: AIService, useValue: mockAIService },
        { provide: CharacterStateService, useValue: mockCharacterStateService },
        { provide: MovementService, useValue: mockMovementService },
        { provide: EnemyStateService, useValue: mockEnemyStateService },
        { provide: SpawningService, useValue: mockSpawningService },
        { provide: BroadcastService, useValue: mockBroadcastService },
        { provide: LootService, useValue: mockLootService },
        { provide: InventoryService, useValue: mockInventoryService },
        { provide: AbilityService, useValue: mockAbilityService },
        { provide: CharacterService, useValue: mockCharacterService },
      ],
    }).compile();

    service = module.get<GameLoopService>(GameLoopService);

    // Set the server instance directly, bypassing startLoop (which also schedules ticks)
    (service as any).server = { to: jest.fn().mockReturnValue({ emit: jest.fn() }) } as unknown as Server;
  });

  afterEach(() => {
    // Stop the loop if it was started
    service.onApplicationShutdown('test');
  });

  /**
   * Helper to invoke the private tickGameLoop method directly.
   */
  async function invokeTick(): Promise<void> {
    await (service as any).tickGameLoop();
  }

  it('should save positions when the interval has elapsed', async () => {
    // Set lastPositionSaveTime to far in the past so interval is exceeded
    (service as any).lastPositionSaveTime = 0;

    const runtimeChar = createMockRuntimeChar(mockUser, { id: 'char-1', positionX: 200, positionY: 300 });
    const mockSocket = { emit: jest.fn() } as any;
    const playerInZone: PlayerInZone = {
      socket: mockSocket,
      user: mockUser,
      characters: [runtimeChar],
    };

    mockZoneService.getActiveZoneIds.mockReturnValue(['zone1']);
    mockPlayerStateStore.getPlayersInZone.mockReturnValue([playerInZone]);
    mockEnemyStateStore.getZoneEnemies.mockReturnValue([]);
    mockCharacterStateService.processCharacterTick.mockResolvedValue({
      diedThisTick: false,
      respawnedThisTick: false,
      combatActions: [],
      enemyHealthUpdates: [],
      characterData: runtimeChar,
      pickedUpItemId: null,
    });

    await invokeTick();

    expect(mockCharacterService.saveCharacterPositions).toHaveBeenCalledWith([
      { characterId: 'char-1', positionX: 200, positionY: 300, currentZoneId: 'zone1' },
    ]);
  });

  it('should NOT save positions when interval has not elapsed', async () => {
    // Set lastPositionSaveTime to right now so interval is NOT exceeded
    (service as any).lastPositionSaveTime = Date.now();

    const runtimeChar = createMockRuntimeChar(mockUser, { id: 'char-1', positionX: 200, positionY: 300 });
    const mockSocket = { emit: jest.fn() } as any;
    const playerInZone: PlayerInZone = {
      socket: mockSocket,
      user: mockUser,
      characters: [runtimeChar],
    };

    mockZoneService.getActiveZoneIds.mockReturnValue(['zone1']);
    mockPlayerStateStore.getPlayersInZone.mockReturnValue([playerInZone]);
    mockEnemyStateStore.getZoneEnemies.mockReturnValue([]);
    mockCharacterStateService.processCharacterTick.mockResolvedValue({
      diedThisTick: false,
      respawnedThisTick: false,
      combatActions: [],
      enemyHealthUpdates: [],
      characterData: runtimeChar,
      pickedUpItemId: null,
    });

    await invokeTick();

    expect(mockCharacterService.saveCharacterPositions).not.toHaveBeenCalled();
  });

  it('should update lastPositionSaveTime after saving', async () => {
    (service as any).lastPositionSaveTime = 0;

    mockZoneService.getActiveZoneIds.mockReturnValue([]);

    const beforeTick = Date.now();
    await invokeTick();

    expect((service as any).lastPositionSaveTime).toBeGreaterThanOrEqual(beforeTick);
  });

  it('should skip characters with null positions when saving', async () => {
    (service as any).lastPositionSaveTime = 0;

    const charWithPos = createMockRuntimeChar(mockUser, { id: 'char-1', positionX: 200, positionY: 300 });
    const charNullPos = createMockRuntimeChar(mockUser, { id: 'char-2', positionX: null as any, positionY: null as any });
    const mockSocket = { emit: jest.fn() } as any;
    const playerInZone: PlayerInZone = {
      socket: mockSocket,
      user: mockUser,
      characters: [charWithPos, charNullPos],
    };

    mockZoneService.getActiveZoneIds.mockReturnValue(['zone1']);
    mockPlayerStateStore.getPlayersInZone.mockReturnValue([playerInZone]);
    mockEnemyStateStore.getZoneEnemies.mockReturnValue([]);
    mockCharacterStateService.processCharacterTick.mockResolvedValue({
      diedThisTick: false,
      respawnedThisTick: false,
      combatActions: [],
      enemyHealthUpdates: [],
      characterData: charWithPos,
      pickedUpItemId: null,
    });

    await invokeTick();

    expect(mockCharacterService.saveCharacterPositions).toHaveBeenCalledWith([
      { characterId: 'char-1', positionX: 200, positionY: 300, currentZoneId: 'zone1' },
    ]);
  });

  it('should not call saveCharacterPositions when there are no position updates', async () => {
    (service as any).lastPositionSaveTime = 0;

    // No active zones => no players => no position updates
    mockZoneService.getActiveZoneIds.mockReturnValue([]);

    await invokeTick();

    // The code checks: if (positionUpdates.length > 0) before calling save
    expect(mockCharacterService.saveCharacterPositions).not.toHaveBeenCalled();
  });

  it('position save should be fire-and-forget (uses .catch, does not block tick)', async () => {
    (service as any).lastPositionSaveTime = 0;

    // Make saveCharacterPositions reject
    mockCharacterService.saveCharacterPositions.mockRejectedValueOnce(new Error('DB down'));

    const runtimeChar = createMockRuntimeChar(mockUser, { id: 'char-1', positionX: 100, positionY: 100 });
    const mockSocket = { emit: jest.fn() } as any;
    const playerInZone: PlayerInZone = {
      socket: mockSocket,
      user: mockUser,
      characters: [runtimeChar],
    };

    mockZoneService.getActiveZoneIds.mockReturnValue(['zone1']);
    mockPlayerStateStore.getPlayersInZone.mockReturnValue([playerInZone]);
    mockEnemyStateStore.getZoneEnemies.mockReturnValue([]);
    mockCharacterStateService.processCharacterTick.mockResolvedValue({
      diedThisTick: false,
      respawnedThisTick: false,
      combatActions: [],
      enemyHealthUpdates: [],
      characterData: runtimeChar,
      pickedUpItemId: null,
    });

    // Should not throw - the .catch() on the promise should handle it
    await expect(invokeTick()).resolves.toBeUndefined();
  });

  it('should collect positions from multiple zones', async () => {
    (service as any).lastPositionSaveTime = 0;

    const char1 = createMockRuntimeChar(mockUser, { id: 'char-1', positionX: 100, positionY: 200 });
    const char2 = createMockRuntimeChar(mockUser, { id: 'char-2', positionX: 300, positionY: 400 });
    const mockSocket = { emit: jest.fn() } as any;
    const player1: PlayerInZone = { socket: mockSocket, user: mockUser, characters: [char1] };
    const player2: PlayerInZone = { socket: mockSocket, user: { ...mockUser, id: 'user-2' } as User, characters: [char2] };

    mockZoneService.getActiveZoneIds.mockReturnValue(['zone1', 'zone2']);
    mockPlayerStateStore.getPlayersInZone.mockImplementation((zoneId: string) => {
      if (zoneId === 'zone1') return [player1];
      if (zoneId === 'zone2') return [player2];
      return [];
    });
    mockEnemyStateStore.getZoneEnemies.mockReturnValue([]);
    mockCharacterStateService.processCharacterTick.mockResolvedValue({
      diedThisTick: false,
      respawnedThisTick: false,
      combatActions: [],
      enemyHealthUpdates: [],
      characterData: char1,
      pickedUpItemId: null,
    });

    await invokeTick();

    expect(mockCharacterService.saveCharacterPositions).toHaveBeenCalledWith(
      expect.arrayContaining([
        { characterId: 'char-1', positionX: 100, positionY: 200, currentZoneId: 'zone1' },
        { characterId: 'char-2', positionX: 300, positionY: 400, currentZoneId: 'zone2' },
      ]),
    );
  });
});
