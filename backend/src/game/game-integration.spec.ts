import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { GameLoopService } from './game-loop.service';
import { ZoneService } from './zone.service';
import { PlayerStateStore, RuntimeCharacterData, PlayerInZone } from './stores/player-state.store';
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
import { EnemyService } from '../enemy/enemy.service';
import { CharacterClass } from '../common/enums/character-class.enum';
import { GameConfig } from '../common/config/game.config';
import { User } from '../user/user.entity';
import { Character } from '../character/character.entity';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { SpawnNest } from './interfaces/spawn-nest.interface';
import { Server } from 'socket.io';

// ─── Shared Helpers ──────────────────────────────────────────────────────────

const ZONE_ID = 'startZone';

const mockUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  username: 'TestUser',
  passwordHash: 'hashed',
  characters: [],
  inventoryItems: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
} as User);

const createMockCharacter = (overrides: Partial<Character> = {}): Character => ({
  id: 'char-1',
  name: 'Hero',
  userId: 'user-1',
  user: mockUser(),
  positionX: 200,
  positionY: 300,
  currentZoneId: ZONE_ID,
  level: 5,
  xp: 100,
  baseHealth: 100,
  baseAttack: 15,
  baseDefense: 5,
  attackSpeed: 1500,
  attackRange: 50,
  aggroRange: 150,
  leashDistance: 400,
  class: CharacterClass.FIGHTER,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
} as Character);

const createMockSocket = (user: User = mockUser()): any => {
  const socket = {
    id: `socket-${user.id}`,
    data: { user },
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
  };
  return socket;
};

const createTestEnemy = (zoneId: string, overrides: Partial<EnemyInstance> = {}): EnemyInstance => ({
  id: 'enemy-1',
  templateId: 'tmpl-goblin',
  zoneId,
  name: 'Goblin',
  currentHealth: 50,
  baseHealth: 50,
  baseAttack: 8,
  baseDefense: 3,
  baseSpeed: 75,
  position: { x: 300, y: 300 },
  aiState: 'IDLE',
  lootTableId: null,
  spriteKey: 'goblin',
  ...overrides,
});

// ─── Integration Test Module Builder ─────────────────────────────────────────

/**
 * Builds a TestingModule with real stores + services, mocked DB-layer deps.
 * Returns all injectable instances for direct manipulation.
 */
async function buildTestModule() {
  // Mocked DB-boundary services
  const mockCharacterService = {
    calculateEffectiveStats: jest.fn().mockResolvedValue({ effectiveAttack: 15, effectiveDefense: 5 }),
    addXp: jest.fn().mockResolvedValue({ id: 'char-1', xp: 200, level: 5 }),
    saveCharacterPositions: jest.fn().mockResolvedValue(undefined),
  };
  const mockEnemyService = {
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
  };
  const mockLootService = {
    calculateLootDrops: jest.fn().mockResolvedValue([]),
  };
  const mockInventoryService = {
    getUserInventorySlots: jest.fn().mockResolvedValue([]),
  };
  const mockAbilityService = {
    findById: jest.fn().mockResolvedValue(null),
  };

  // Mock ZoneService to avoid constructor calling createZone before stores are ready
  // (forwardRef chain: PlayerStateStore → EnemyStateStore → NestStateStore causes
  // stores to not be fully initialized when ZoneService constructor runs in test)
  const mockZoneService = {
    getActiveZoneIds: jest.fn().mockReturnValue([ZONE_ID]),
    createZone: jest.fn(),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      // Real game logic stores + services
      PlayerStateStore,
      EnemyStateStore,
      NestStateStore,
      DroppedItemStore,
      SpellQueueStore,
      CombatService,
      CharacterStateService,
      EnemyStateService,
      AIService,
      MovementService,
      SpawningService,
      BroadcastService,
      GameLoopService,
      // Mock ZoneService (constructor side effects)
      { provide: ZoneService, useValue: mockZoneService },
      // Mocked DB/external
      { provide: CharacterService, useValue: mockCharacterService },
      { provide: EnemyService, useValue: mockEnemyService },
      { provide: LootService, useValue: mockLootService },
      { provide: InventoryService, useValue: mockInventoryService },
      { provide: AbilityService, useValue: mockAbilityService },
      { provide: Logger, useValue: new Logger('TestBroadcast') },
    ],
  }).compile();

  // Initialize the module (triggers NestStateStore.onModuleInit → findAll returns [])
  await module.init();

  const gameLoop = module.get(GameLoopService);
  const playerStore = module.get(PlayerStateStore);
  const enemyStore = module.get(EnemyStateStore);
  const nestStore = module.get(NestStateStore);
  const droppedItemStore = module.get(DroppedItemStore);
  const spellQueueStore = module.get(SpellQueueStore);
  const combatService = module.get(CombatService);
  const characterStateService = module.get(CharacterStateService);
  const movementService = module.get(MovementService);
  const aiService = module.get(AIService);
  const spawningService = module.get(SpawningService);
  const broadcastService = module.get(BroadcastService);
  const enemyStateService = module.get(EnemyStateService);

  // Manually initialize zones on all stores (ZoneService.createZone was mocked)
  playerStore.ensureZone(ZONE_ID);
  enemyStore.ensureZone(ZONE_ID);
  nestStore.ensureZone(ZONE_ID);
  droppedItemStore.ensureZone(ZONE_ID);
  spellQueueStore.ensureZone(ZONE_ID);

  // Set mock server on GameLoopService (bypasses startLoop)
  const mockServer = { to: jest.fn().mockReturnValue({ emit: jest.fn() }) } as unknown as Server;
  (gameLoop as any).server = mockServer;
  // Also set on broadcast service
  broadcastService.setServerInstance(mockServer);

  // Suppress position saves by default (set lastPositionSaveTime to now)
  (gameLoop as any).lastPositionSaveTime = Date.now();

  return {
    module,
    gameLoop,
    playerStore,
    enemyStore,
    nestStore,
    droppedItemStore,
    spellQueueStore,
    mockZoneService,
    combatService,
    characterStateService,
    movementService,
    aiService,
    spawningService,
    broadcastService,
    enemyStateService,
    mockCharacterService,
    mockEnemyService,
    mockLootService,
    mockInventoryService,
    mockAbilityService,
    mockServer,
  };
}

type TestContext = Awaited<ReturnType<typeof buildTestModule>>;

async function invokeTick(ctx: TestContext): Promise<void> {
  await (ctx.gameLoop as any).tickGameLoop();
}

async function tickN(ctx: TestContext, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await invokeTick(ctx);
  }
}

/** Seed an enemy directly into the store (bypasses DB). */
function seedEnemy(ctx: TestContext, zoneId: string, enemy: EnemyInstance): void {
  const zoneMap = (ctx.enemyStore as any).enemies.get(zoneId);
  if (zoneMap) {
    zoneMap.set(enemy.id, enemy);
  }
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

describe('Game Integration Tests', () => {

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Zone Setup & Player Join
  // ───────────────────────────────────────────────────────────────────────────
  describe('Zone Setup & Player Join', () => {
    let ctx: TestContext;

    beforeEach(async () => {
      ctx = await buildTestModule();
    });

    afterEach(() => {
      ctx.gameLoop.onApplicationShutdown('test');
    });

    it('should populate player in store after joining with restored position', async () => {
      const user = mockUser();
      const socket = createMockSocket(user);
      const char = createMockCharacter({
        positionX: 500,
        positionY: 600,
        currentZoneId: ZONE_ID,
      });

      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket, user, [char]);

      const players = ctx.playerStore.getPlayersInZone(ZONE_ID);
      expect(players).toHaveLength(1);
      expect(players[0].characters).toHaveLength(1);
      // Position should be restored (same zone)
      expect(players[0].characters[0].positionX).toBe(500);
      expect(players[0].characters[0].positionY).toBe(600);
      expect(players[0].characters[0].state).toBe('idle');
    });

    it('should give random spawn position when joining a different zone', async () => {
      const user = mockUser();
      const socket = createMockSocket(user);
      const char = createMockCharacter({
        positionX: 500,
        positionY: 600,
        currentZoneId: 'otherZone', // Different from ZONE_ID
      });

      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket, user, [char]);

      const players = ctx.playerStore.getPlayersInZone(ZONE_ID);
      const runtimeChar = players[0].characters[0];
      // Should NOT be 500,600 since zone doesn't match
      // Random spawn is in 100-150 range
      expect(runtimeChar.positionX).toBeGreaterThanOrEqual(100);
      expect(runtimeChar.positionX).toBeLessThanOrEqual(150);
      expect(runtimeChar.positionY).toBeGreaterThanOrEqual(100);
      expect(runtimeChar.positionY).toBeLessThanOrEqual(150);
    });

    it('should return both players from getZoneCharacterStates', async () => {
      const user1 = mockUser({ id: 'user-1', username: 'Player1' });
      const user2 = mockUser({ id: 'user-2', username: 'Player2' });
      const socket1 = createMockSocket(user1);
      const socket2 = createMockSocket(user2);

      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket1, user1, [
        createMockCharacter({ id: 'char-1', userId: 'user-1' }),
      ]);
      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket2, user2, [
        createMockCharacter({ id: 'char-2', userId: 'user-2', name: 'Mage' }),
      ]);

      const states = ctx.playerStore.getZoneCharacterStates(ZONE_ID);
      expect(states).toHaveLength(2);
      const ids = states.map(s => s.id);
      expect(ids).toContain('char-1');
      expect(ids).toContain('char-2');
    });

    it('should return existing enemies via getZoneEnemies', () => {
      const enemy = createTestEnemy(ZONE_ID);
      seedEnemy(ctx, ZONE_ID, enemy);

      const enemies = ctx.enemyStore.getZoneEnemies(ZONE_ID);
      expect(enemies).toHaveLength(1);
      expect(enemies[0].id).toBe('enemy-1');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Movement
  // ───────────────────────────────────────────────────────────────────────────
  describe('Movement', () => {
    let ctx: TestContext;

    beforeEach(async () => {
      ctx = await buildTestModule();
    });

    afterEach(() => {
      ctx.gameLoop.onApplicationShutdown('test');
    });

    it('setMovementTarget should set state to moving and clear attack target', async () => {
      const user = mockUser();
      const socket = createMockSocket(user);
      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket, user, [
        createMockCharacter({ id: 'char-1', positionX: 100, positionY: 100, currentZoneId: ZONE_ID }),
      ]);

      ctx.playerStore.setMovementTarget(ZONE_ID, 'char-1', 200, 200);

      const char = ctx.playerStore.getCharacterStateById(ZONE_ID, 'char-1')!;
      expect(char.state).toBe('moving');
      expect(char.targetX).toBe(200);
      expect(char.targetY).toBe(200);
      expect(char.attackTargetId).toBeNull();
    });

    it('one tick should advance position and broadcast entityUpdate', async () => {
      const user = mockUser();
      const socket = createMockSocket(user);
      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket, user, [
        createMockCharacter({ id: 'char-1', positionX: 100, positionY: 100, currentZoneId: ZONE_ID }),
      ]);

      ctx.playerStore.setMovementTarget(ZONE_ID, 'char-1', 200, 100);

      await invokeTick(ctx);

      const char = ctx.playerStore.getCharacterStateById(ZONE_ID, 'char-1')!;
      // Speed = 150 pps, deltaTime = 0.1s => 15px per tick, moving along X axis
      expect(char.positionX).toBeCloseTo(115, 0);
      expect(char.positionY).toBeCloseTo(100, 0);

      // Verify broadcast was flushed (server.to was called)
      expect(ctx.mockServer.to).toHaveBeenCalledWith(ZONE_ID);
    });

    it('multiple ticks should bring character to a nearby target', async () => {
      const user = mockUser();
      const socket = createMockSocket(user);
      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket, user, [
        createMockCharacter({ id: 'char-1', positionX: 100, positionY: 100, currentZoneId: ZONE_ID }),
      ]);

      // Target only 30px away: 2 ticks × 15px = 30px exactly
      ctx.playerStore.setMovementTarget(ZONE_ID, 'char-1', 130, 100);

      await tickN(ctx, 3); // 3 ticks should be more than enough

      const char = ctx.playerStore.getCharacterStateById(ZONE_ID, 'char-1')!;
      expect(char.positionX).toBeCloseTo(130, 0);
      expect(char.positionY).toBeCloseTo(100, 0);
      // Should have transitioned to idle since target was reached
      expect(char.state).toBe('idle');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Combat Flow
  // ───────────────────────────────────────────────────────────────────────────
  describe('Combat Flow', () => {
    let ctx: TestContext;

    beforeEach(async () => {
      ctx = await buildTestModule();
    });

    afterEach(() => {
      ctx.gameLoop.onApplicationShutdown('test');
    });

    it('setAttackTarget should set state to attacking', async () => {
      const user = mockUser();
      const socket = createMockSocket(user);
      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket, user, [
        createMockCharacter({ id: 'char-1', positionX: 200, positionY: 200, currentZoneId: ZONE_ID }),
      ]);

      const enemy = createTestEnemy(ZONE_ID, { id: 'enemy-1', position: { x: 220, y: 200 } });
      seedEnemy(ctx, ZONE_ID, enemy);

      const result = ctx.playerStore.setAttackTarget(ZONE_ID, 'char-1', 'enemy-1');

      expect(result).toBe(true);
      const char = ctx.playerStore.getCharacterStateById(ZONE_ID, 'char-1')!;
      expect(char.state).toBe('attacking');
      expect(char.attackTargetId).toBe('enemy-1');
    });

    it('out-of-range attack should walk character toward enemy', async () => {
      const user = mockUser();
      const socket = createMockSocket(user);
      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket, user, [
        createMockCharacter({
          id: 'char-1',
          positionX: 100,
          positionY: 100,
          attackRange: 50,
          currentZoneId: ZONE_ID,
        }),
      ]);

      // Place enemy far away (200px distance, attack range is 50)
      const enemy = createTestEnemy(ZONE_ID, {
        id: 'enemy-far',
        position: { x: 300, y: 100 },
      });
      seedEnemy(ctx, ZONE_ID, enemy);

      ctx.playerStore.setAttackTarget(ZONE_ID, 'char-1', 'enemy-far');
      await invokeTick(ctx);

      const char = ctx.playerStore.getCharacterStateById(ZONE_ID, 'char-1')!;
      // Character should have moved toward enemy (state becomes 'moving' from attackingState
      // since it's out of range, which calls setMovementTarget)
      expect(char.positionX).toBeGreaterThan(100);
    });

    it('in-range attack should deal damage and broadcast combat action', async () => {
      const user = mockUser();
      const socket = createMockSocket(user);
      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket, user, [
        createMockCharacter({
          id: 'char-1',
          positionX: 200,
          positionY: 200,
          attackRange: 50,
          lastAttackTime: 0,
          currentZoneId: ZONE_ID,
        }),
      ]);

      const enemy = createTestEnemy(ZONE_ID, {
        id: 'enemy-close',
        position: { x: 220, y: 200 }, // 20px away, within 50 range
        currentHealth: 50,
        baseHealth: 50,
        baseDefense: 3,
      });
      seedEnemy(ctx, ZONE_ID, enemy);

      // Set character to attack this enemy
      ctx.playerStore.setAttackTarget(ZONE_ID, 'char-1', 'enemy-close');

      // Force lastAttackTime to allow immediate attack
      const char = ctx.playerStore.getCharacterStateById(ZONE_ID, 'char-1')!;
      char.lastAttackTime = 0;

      await invokeTick(ctx);

      // Enemy should have taken damage
      const updatedEnemy = ctx.enemyStore.getEnemyInstanceById(ZONE_ID, 'enemy-close')!;
      expect(updatedEnemy.currentHealth).toBeLessThan(50);
    });

    it('attack cooldown should block rapid attacks', async () => {
      const user = mockUser();
      const socket = createMockSocket(user);
      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket, user, [
        createMockCharacter({
          id: 'char-1',
          positionX: 200,
          positionY: 200,
          attackRange: 50,
          attackSpeed: 1500,
          currentZoneId: ZONE_ID,
        }),
      ]);

      const enemy = createTestEnemy(ZONE_ID, {
        id: 'enemy-cd',
        position: { x: 220, y: 200 },
        currentHealth: 200,
        baseHealth: 200,
        baseDefense: 3,
      });
      seedEnemy(ctx, ZONE_ID, enemy);

      ctx.playerStore.setAttackTarget(ZONE_ID, 'char-1', 'enemy-cd');

      // First tick: attack connects (lastAttackTime = 0)
      const char = ctx.playerStore.getCharacterStateById(ZONE_ID, 'char-1')!;
      char.lastAttackTime = 0;
      await invokeTick(ctx);
      const healthAfterFirst = ctx.enemyStore.getEnemyInstanceById(ZONE_ID, 'enemy-cd')!.currentHealth;
      expect(healthAfterFirst).toBeLessThan(200);

      // Second tick immediately after: should NOT deal more damage (cooldown not elapsed)
      // tickGameLoop uses Date.now() as `now`, and lastAttackTime was just set to now
      await invokeTick(ctx);
      const healthAfterSecond = ctx.enemyStore.getEnemyInstanceById(ZONE_ID, 'enemy-cd')!.currentHealth;
      expect(healthAfterSecond).toBe(healthAfterFirst);
    });

    it('enemy death should mark isDying and transition character to idle', async () => {
      const user = mockUser();
      const socket = createMockSocket(user);
      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket, user, [
        createMockCharacter({
          id: 'char-1',
          positionX: 200,
          positionY: 200,
          attackRange: 50,
          baseAttack: 100, // Very high attack to one-shot
          currentZoneId: ZONE_ID,
        }),
      ]);

      const enemy = createTestEnemy(ZONE_ID, {
        id: 'enemy-weak',
        position: { x: 220, y: 200 },
        currentHealth: 1, // Will die in one hit
        baseHealth: 50,
        baseDefense: 0,
      });
      seedEnemy(ctx, ZONE_ID, enemy);

      ctx.playerStore.setAttackTarget(ZONE_ID, 'char-1', 'enemy-weak');
      const char = ctx.playerStore.getCharacterStateById(ZONE_ID, 'char-1')!;
      char.lastAttackTime = 0;

      await invokeTick(ctx);

      // Enemy should be dying
      const deadEnemy = ctx.enemyStore.getEnemyInstanceById(ZONE_ID, 'enemy-weak')!;
      expect(deadEnemy.isDying).toBe(true);
      expect(deadEnemy.currentHealth).toBe(0);

      // Character should transition to idle
      const updatedChar = ctx.playerStore.getCharacterStateById(ZONE_ID, 'char-1')!;
      expect(updatedChar.state).toBe('idle');
      expect(updatedChar.attackTargetId).toBeNull();
    });

    it('should grant XP on enemy kill via characterService.addXp', async () => {
      const user = mockUser();
      const socket = createMockSocket(user);
      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket, user, [
        createMockCharacter({
          id: 'char-1',
          positionX: 200,
          positionY: 200,
          attackRange: 50,
          baseAttack: 100,
          currentZoneId: ZONE_ID,
        }),
      ]);

      // Mock enemy template with XP reward
      ctx.mockEnemyService.findOne.mockResolvedValue({
        id: 'tmpl-goblin',
        name: 'Goblin',
        baseHealth: 50,
        baseAttack: 8,
        baseDefense: 0,
        baseSpeed: 75,
        xpReward: 25,
        spriteKey: 'goblin',
        lootTableId: null,
      });

      const enemy = createTestEnemy(ZONE_ID, {
        id: 'enemy-xp',
        position: { x: 220, y: 200 },
        currentHealth: 1,
        baseHealth: 50,
        baseDefense: 0,
      });
      seedEnemy(ctx, ZONE_ID, enemy);

      ctx.playerStore.setAttackTarget(ZONE_ID, 'char-1', 'enemy-xp');
      const char = ctx.playerStore.getCharacterStateById(ZONE_ID, 'char-1')!;
      char.lastAttackTime = 0;

      await invokeTick(ctx);

      expect(ctx.mockCharacterService.addXp).toHaveBeenCalledWith('char-1', 25);
    });

    it('should call calculateLootDrops on enemy kill with lootTableId', async () => {
      const user = mockUser();
      const socket = createMockSocket(user);
      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket, user, [
        createMockCharacter({
          id: 'char-1',
          positionX: 200,
          positionY: 200,
          attackRange: 50,
          baseAttack: 100,
          currentZoneId: ZONE_ID,
        }),
      ]);

      const enemy = createTestEnemy(ZONE_ID, {
        id: 'enemy-loot',
        position: { x: 220, y: 200 },
        currentHealth: 1,
        baseHealth: 50,
        baseDefense: 0,
        lootTableId: 'loot-table-1',
      });
      seedEnemy(ctx, ZONE_ID, enemy);

      ctx.playerStore.setAttackTarget(ZONE_ID, 'char-1', 'enemy-loot');
      const char = ctx.playerStore.getCharacterStateById(ZONE_ID, 'char-1')!;
      char.lastAttackTime = 0;

      await invokeTick(ctx);

      expect(ctx.mockLootService.calculateLootDrops).toHaveBeenCalledWith('loot-table-1');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Disconnect & Rejoin
  // ───────────────────────────────────────────────────────────────────────────
  describe('Disconnect & Rejoin', () => {
    let ctx: TestContext;

    beforeEach(async () => {
      ctx = await buildTestModule();
    });

    afterEach(() => {
      ctx.gameLoop.onApplicationShutdown('test');
    });

    it('removePlayerFromZone should clear the player from store', async () => {
      const user = mockUser();
      const socket = createMockSocket(user);
      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket, user, [
        createMockCharacter({ currentZoneId: ZONE_ID }),
      ]);

      expect(ctx.playerStore.getPlayersInZone(ZONE_ID)).toHaveLength(1);

      const result = ctx.playerStore.removePlayerFromZone(socket);

      expect(result).not.toBeNull();
      expect(result!.zoneId).toBe(ZONE_ID);
      expect(ctx.playerStore.getPlayersInZone(ZONE_ID)).toHaveLength(0);
    });

    it('periodic save should call saveCharacterPositions with correct data', async () => {
      const user = mockUser();
      const socket = createMockSocket(user);
      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket, user, [
        createMockCharacter({ id: 'char-1', positionX: 300, positionY: 400, currentZoneId: ZONE_ID }),
      ]);

      // Force save interval to trigger
      (ctx.gameLoop as any).lastPositionSaveTime = 0;

      await invokeTick(ctx);

      expect(ctx.mockCharacterService.saveCharacterPositions).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            characterId: 'char-1',
            positionX: expect.any(Number),
            positionY: expect.any(Number),
            currentZoneId: ZONE_ID,
          }),
        ]),
      );
    });

    it('rejoin same zone should restore saved position', async () => {
      const user = mockUser();
      const socket1 = createMockSocket(user);

      // Join, then leave
      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket1, user, [
        createMockCharacter({ id: 'char-1', positionX: 500, positionY: 600, currentZoneId: ZONE_ID }),
      ]);
      ctx.playerStore.removePlayerFromZone(socket1);

      // Rejoin with character data that has the same zone + position saved
      const socket2 = createMockSocket(user);
      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket2, user, [
        createMockCharacter({ id: 'char-1', positionX: 500, positionY: 600, currentZoneId: ZONE_ID }),
      ]);

      const char = ctx.playerStore.getCharacterStateById(ZONE_ID, 'char-1')!;
      expect(char.positionX).toBe(500);
      expect(char.positionY).toBe(600);
    });

    it('rejoin different zone should give random spawn position', async () => {
      const user = mockUser();
      const socket = createMockSocket(user);

      // Character was in 'otherZone' but joins ZONE_ID
      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket, user, [
        createMockCharacter({ id: 'char-1', positionX: 500, positionY: 600, currentZoneId: 'otherZone' }),
      ]);

      const char = ctx.playerStore.getCharacterStateById(ZONE_ID, 'char-1')!;
      // Should be random spawn (100-150 range), not 500/600
      expect(char.positionX).not.toBe(500);
      expect(char.positionX).toBeGreaterThanOrEqual(100);
      expect(char.positionX).toBeLessThanOrEqual(150);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Enemy Spawning
  // ───────────────────────────────────────────────────────────────────────────
  describe('Enemy Spawning', () => {
    let ctx: TestContext;

    const mockTemplate = {
      id: 'tmpl-goblin',
      name: 'Goblin',
      baseHealth: 50,
      baseAttack: 8,
      baseDefense: 3,
      baseSpeed: 75,
      xpReward: 25,
      spriteKey: 'goblin',
      lootTableId: null,
    };

    beforeEach(async () => {
      ctx = await buildTestModule();

      // Override findOne to return our template
      ctx.mockEnemyService.findOne.mockResolvedValue(mockTemplate);
    });

    afterEach(() => {
      ctx.gameLoop.onApplicationShutdown('test');
    });

    function createTestNest(overrides: Partial<SpawnNest> = {}): SpawnNest {
      return {
        id: 'goblin-nest-1',
        zoneId: ZONE_ID,
        templateId: 'tmpl-goblin',
        center: { x: 500, y: 500 },
        radius: 100,
        maxCapacity: 3,
        currentEnemyIds: new Set(),
        respawnDelayMs: 5000,
        lastSpawnCheckTime: 0,
        ...overrides,
      };
    }

    function addNestToStore(nest: SpawnNest): void {
      const zoneNests = (ctx.nestStore as any).nests.get(ZONE_ID);
      if (zoneNests) {
        zoneNests.set(nest.id, nest);
      }
    }

    it('initialPopulateZone should fill nests to capacity', async () => {
      const nest = createTestNest({ maxCapacity: 3 });
      addNestToStore(nest);

      const totalSpawned = await ctx.spawningService.initialPopulateZone(ZONE_ID);

      expect(totalSpawned).toBe(3);
      expect(nest.currentEnemyIds.size).toBe(3);
      const enemies = ctx.enemyStore.getZoneEnemies(ZONE_ID);
      expect(enemies).toHaveLength(3);
    });

    it('should not spawn when nest is at capacity', async () => {
      const nest = createTestNest({ maxCapacity: 2 });
      addNestToStore(nest);

      await ctx.spawningService.initialPopulateZone(ZONE_ID);
      expect(nest.currentEnemyIds.size).toBe(2);

      // processNestSpawns should not add more
      const now = Date.now() + 100000; // Well past respawn delay
      const spawned = await ctx.spawningService.processNestSpawns(ZONE_ID, now);
      expect(spawned).toHaveLength(0);
      expect(ctx.enemyStore.getZoneEnemies(ZONE_ID)).toHaveLength(2);
    });

    it('should spawn when timer elapsed and nest below capacity', async () => {
      const nest = createTestNest({
        maxCapacity: 3,
        respawnDelayMs: 5000,
        lastSpawnCheckTime: 0,
      });
      addNestToStore(nest);

      // Pre-populate to 2 (below capacity of 3)
      await ctx.spawningService.initialPopulateZone(ZONE_ID);
      expect(nest.currentEnemyIds.size).toBe(3);

      // Remove one enemy to make room
      const enemies = ctx.enemyStore.getZoneEnemies(ZONE_ID);
      ctx.enemyStore.removeEnemy(ZONE_ID, enemies[0].id);
      expect(nest.currentEnemyIds.size).toBe(2);

      // Call processNestSpawns well after the delay
      const now = Date.now() + 100000;
      const spawned = await ctx.spawningService.processNestSpawns(ZONE_ID, now);

      expect(spawned).toHaveLength(1);
      expect(ctx.enemyStore.getZoneEnemies(ZONE_ID)).toHaveLength(3);
    });

    it('full respawn cycle: kill → cleanup → respawn', async () => {
      const nest = createTestNest({ maxCapacity: 1, respawnDelayMs: 100 });
      addNestToStore(nest);

      // Add player so ticks aren't skipped (need at least one player or enemy)
      const user = mockUser();
      const socket = createMockSocket(user);
      await ctx.playerStore.addPlayerToZone(ZONE_ID, socket, user, [
        createMockCharacter({
          id: 'char-1',
          positionX: 100,
          positionY: 100,
          attackRange: 50,
          baseAttack: 200, // Enough to one-shot
          aggroRange: 0, // Prevent auto-aggro
          currentZoneId: ZONE_ID,
        }),
      ]);

      // Populate the nest with 1 enemy
      await ctx.spawningService.initialPopulateZone(ZONE_ID);
      const enemies = ctx.enemyStore.getZoneEnemies(ZONE_ID);
      expect(enemies).toHaveLength(1);
      const originalEnemyId = enemies[0].id;

      // Kill the enemy by setting health to 0 and marking isDying
      const enemy = enemies[0];
      enemy.currentHealth = 0;
      enemy.isDying = true;
      enemy.deathTimestamp = Date.now() - GameConfig.SPAWNING.DYING_CLEANUP_MS - 1000; // Far enough in the past
      enemy.aiState = 'DEAD';

      // Tick to trigger cleanup of dying enemy
      await invokeTick(ctx);

      // Enemy should have been cleaned up
      const postCleanup = ctx.enemyStore.getEnemyInstanceById(ZONE_ID, originalEnemyId);
      expect(postCleanup).toBeUndefined();
      // Nest should have 0 enemies
      expect(nest.currentEnemyIds.size).toBe(0);

      // Set nest timer to allow respawn
      nest.lastSpawnCheckTime = 0;

      // Next tick should trigger a respawn via processNestSpawns
      await invokeTick(ctx);

      const respawnedEnemies = ctx.enemyStore.getZoneEnemies(ZONE_ID);
      expect(respawnedEnemies).toHaveLength(1);
      expect(respawnedEnemies[0].id).not.toBe(originalEnemyId);
      expect(nest.currentEnemyIds.size).toBe(1);
    });
  });
});
