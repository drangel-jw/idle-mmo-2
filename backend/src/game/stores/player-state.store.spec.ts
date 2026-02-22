import { Test, TestingModule } from '@nestjs/testing';
import { PlayerStateStore, RuntimeCharacterData } from './player-state.store';
import { EnemyStateStore } from './enemy-state.store';
import { CharacterService } from '../../character/character.service';
import { BroadcastService } from '../broadcast.service';
import { Character } from '../../character/character.entity';
import { User } from '../../user/user.entity';
import { CharacterClass } from '../../common/enums/character-class.enum';
import { Socket } from 'socket.io';

describe('PlayerStateStore', () => {
  let store: PlayerStateStore;
  let mockCharacterService: Record<string, jest.Mock>;
  let mockBroadcastService: Record<string, jest.Mock>;
  let mockEnemyStateStore: Record<string, jest.Mock>;

  const mockUser: User = {
    id: 'user-1',
    username: 'TestPlayer',
    passwordHash: 'hashed',
    characters: [],
    inventoryItems: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const createMockSocket = (): Socket => ({
    join: jest.fn(),
    leave: jest.fn(),
    data: { user: mockUser },
  } as unknown as Socket);

  const createMockCharacter = (overrides: Partial<Character> = {}): Character => ({
    id: 'char-1',
    name: 'Test Hero',
    userId: mockUser.id,
    user: mockUser,
    level: 5,
    xp: 100,
    baseHealth: 200,
    baseAttack: 20,
    baseDefense: 10,
    attackSpeed: 1500,
    attackRange: 50,
    aggroRange: 150,
    leashDistance: 400,
    positionX: null,
    positionY: null,
    currentZoneId: null,
    class: CharacterClass.FIGHTER,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Character);

  beforeEach(async () => {
    mockCharacterService = {
      calculateEffectiveStats: jest.fn().mockResolvedValue({ effectiveAttack: 25, effectiveDefense: 12 }),
      saveCharacterPositions: jest.fn().mockResolvedValue(undefined),
    };

    mockBroadcastService = {
      queueCharacterStateChange: jest.fn(),
    };

    mockEnemyStateStore = {
      getEnemyInstanceById: jest.fn().mockReturnValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlayerStateStore,
        { provide: CharacterService, useValue: mockCharacterService },
        { provide: BroadcastService, useValue: mockBroadcastService },
        { provide: EnemyStateStore, useValue: mockEnemyStateStore },
      ],
    }).compile();

    store = module.get<PlayerStateStore>(PlayerStateStore);
  });

  describe('addPlayerToZone - position restore logic', () => {
    it('should restore saved position when char.currentZoneId matches zoneId and positions are set', async () => {
      const socket = createMockSocket();
      const character = createMockCharacter({
        currentZoneId: 'zone1',
        positionX: 350,
        positionY: 420,
      });

      await store.addPlayerToZone('zone1', socket, mockUser, [character]);

      const players = store.getPlayersInZone('zone1');
      expect(players).toHaveLength(1);
      const runtimeChar = players[0].characters[0];

      // Should use the saved position, not a random one
      expect(runtimeChar.positionX).toBe(350);
      expect(runtimeChar.positionY).toBe(420);
      expect(runtimeChar.targetX).toBe(350);
      expect(runtimeChar.targetY).toBe(420);
      expect(runtimeChar.anchorX).toBe(350);
      expect(runtimeChar.anchorY).toBe(420);
    });

    it('should use random spawn position when char.currentZoneId does not match zoneId', async () => {
      const socket = createMockSocket();
      const character = createMockCharacter({
        currentZoneId: 'differentZone',
        positionX: 350,
        positionY: 420,
      });

      await store.addPlayerToZone('zone1', socket, mockUser, [character]);

      const players = store.getPlayersInZone('zone1');
      const runtimeChar = players[0].characters[0];

      // Should NOT use the saved position from a different zone
      // Random spawn is 100 + Math.random() * 50, so between 100 and 150
      expect(runtimeChar.positionX).toBeGreaterThanOrEqual(100);
      expect(runtimeChar.positionX).toBeLessThan(150);
      expect(runtimeChar.positionY).toBeGreaterThanOrEqual(100);
      expect(runtimeChar.positionY).toBeLessThan(150);
    });

    it('should use random spawn position when positionX is null', async () => {
      const socket = createMockSocket();
      const character = createMockCharacter({
        currentZoneId: 'zone1',
        positionX: null,
        positionY: 420,
      });

      await store.addPlayerToZone('zone1', socket, mockUser, [character]);

      const players = store.getPlayersInZone('zone1');
      const runtimeChar = players[0].characters[0];

      // positionX was null, so hasSavedPosition is false => random spawn
      expect(runtimeChar.positionX).toBeGreaterThanOrEqual(100);
      expect(runtimeChar.positionX).toBeLessThan(150);
    });

    it('should use random spawn position when positionY is null', async () => {
      const socket = createMockSocket();
      const character = createMockCharacter({
        currentZoneId: 'zone1',
        positionX: 350,
        positionY: null,
      });

      await store.addPlayerToZone('zone1', socket, mockUser, [character]);

      const players = store.getPlayersInZone('zone1');
      const runtimeChar = players[0].characters[0];

      // positionY was null, so hasSavedPosition is false => random spawn
      expect(runtimeChar.positionY).toBeGreaterThanOrEqual(100);
      expect(runtimeChar.positionY).toBeLessThan(150);
    });

    it('should use random spawn position when currentZoneId is null', async () => {
      const socket = createMockSocket();
      const character = createMockCharacter({
        currentZoneId: null,
        positionX: 350,
        positionY: 420,
      });

      await store.addPlayerToZone('zone1', socket, mockUser, [character]);

      const players = store.getPlayersInZone('zone1');
      const runtimeChar = players[0].characters[0];

      // currentZoneId is null != 'zone1', so random spawn
      expect(runtimeChar.positionX).toBeGreaterThanOrEqual(100);
      expect(runtimeChar.positionX).toBeLessThan(150);
    });

    it('should restore position (0, 0) correctly without treating it as null', async () => {
      const socket = createMockSocket();
      const character = createMockCharacter({
        currentZoneId: 'zone1',
        positionX: 0,
        positionY: 0,
      });

      await store.addPlayerToZone('zone1', socket, mockUser, [character]);

      const players = store.getPlayersInZone('zone1');
      const runtimeChar = players[0].characters[0];

      // positionX=0 and positionY=0 are valid coordinates and should be restored
      expect(runtimeChar.positionX).toBe(0);
      expect(runtimeChar.positionY).toBe(0);
    });

    it('should always reset health to baseHealth on join, regardless of position restore', async () => {
      const socket = createMockSocket();
      const character = createMockCharacter({
        currentZoneId: 'zone1',
        positionX: 350,
        positionY: 420,
        baseHealth: 200,
      });

      await store.addPlayerToZone('zone1', socket, mockUser, [character]);

      const players = store.getPlayersInZone('zone1');
      const runtimeChar = players[0].characters[0];

      // Health always resets to baseHealth on join
      expect(runtimeChar.currentHealth).toBe(200);
    });

    it('should reset health to baseHealth even for random spawn scenario', async () => {
      const socket = createMockSocket();
      const character = createMockCharacter({
        currentZoneId: 'differentZone',
        positionX: 350,
        positionY: 420,
        baseHealth: 150,
      });

      await store.addPlayerToZone('zone1', socket, mockUser, [character]);

      const players = store.getPlayersInZone('zone1');
      const runtimeChar = players[0].characters[0];

      expect(runtimeChar.currentHealth).toBe(150);
    });

    it('should handle multiple characters with mixed position states', async () => {
      const socket = createMockSocket();
      const charWithSaved = createMockCharacter({
        id: 'char-saved',
        currentZoneId: 'zone1',
        positionX: 300,
        positionY: 400,
        baseHealth: 200,
      });
      const charWithoutSaved = createMockCharacter({
        id: 'char-random',
        currentZoneId: 'otherZone',
        positionX: 500,
        positionY: 600,
        baseHealth: 100,
      });

      await store.addPlayerToZone('zone1', socket, mockUser, [charWithSaved, charWithoutSaved]);

      const players = store.getPlayersInZone('zone1');
      const chars = players[0].characters;

      // First character: saved position restored
      expect(chars[0].positionX).toBe(300);
      expect(chars[0].positionY).toBe(400);
      expect(chars[0].currentHealth).toBe(200);

      // Second character: random spawn (different zone)
      expect(chars[1].positionX).toBeGreaterThanOrEqual(100);
      expect(chars[1].positionX).toBeLessThan(150);
      expect(chars[1].currentHealth).toBe(100);
    });

    it('should set initial state to idle and clear combat state on join', async () => {
      const socket = createMockSocket();
      const character = createMockCharacter({
        currentZoneId: 'zone1',
        positionX: 200,
        positionY: 300,
      });

      await store.addPlayerToZone('zone1', socket, mockUser, [character]);

      const players = store.getPlayersInZone('zone1');
      const runtimeChar = players[0].characters[0];

      expect(runtimeChar.state).toBe('idle');
      expect(runtimeChar.attackTargetId).toBeNull();
      expect(runtimeChar.targetItemId).toBeNull();
      expect(runtimeChar.commandState).toBeNull();
      expect(runtimeChar.timeOfDeath).toBeNull();
      expect(runtimeChar.lastAttackTime).toBe(0);
    });

    it('should use effective stats from characterService', async () => {
      const socket = createMockSocket();
      const character = createMockCharacter({
        baseAttack: 20,
        baseDefense: 10,
      });

      await store.addPlayerToZone('zone1', socket, mockUser, [character]);

      const players = store.getPlayersInZone('zone1');
      const runtimeChar = players[0].characters[0];

      expect(mockCharacterService.calculateEffectiveStats).toHaveBeenCalledWith('char-1');
      expect(runtimeChar.effectiveAttack).toBe(25);
      expect(runtimeChar.effectiveDefense).toBe(12);
    });

    it('should fall back to base stats if calculateEffectiveStats throws', async () => {
      mockCharacterService.calculateEffectiveStats.mockRejectedValueOnce(new Error('DB error'));

      const socket = createMockSocket();
      const character = createMockCharacter({
        baseAttack: 20,
        baseDefense: 10,
      });

      await store.addPlayerToZone('zone1', socket, mockUser, [character]);

      const players = store.getPlayersInZone('zone1');
      const runtimeChar = players[0].characters[0];

      // Falls back to base stats
      expect(runtimeChar.effectiveAttack).toBe(20);
      expect(runtimeChar.effectiveDefense).toBe(10);
    });

    it('should set currentZoneId on runtime character to the zone being joined', async () => {
      const socket = createMockSocket();
      const character = createMockCharacter({
        currentZoneId: 'oldZone',
      });

      await store.addPlayerToZone('zone1', socket, mockUser, [character]);

      const players = store.getPlayersInZone('zone1');
      const runtimeChar = players[0].characters[0];

      expect(runtimeChar.currentZoneId).toBe('zone1');
    });

    it('should call socket.join with the zoneId', async () => {
      const socket = createMockSocket();
      const character = createMockCharacter();

      await store.addPlayerToZone('zone1', socket, mockUser, [character]);

      expect(socket.join).toHaveBeenCalledWith('zone1');
    });

    it('should default class to FIGHTER when character has no class', async () => {
      const socket = createMockSocket();
      const character = createMockCharacter();
      // Simulate missing class
      (character as any).class = undefined;

      await store.addPlayerToZone('zone1', socket, mockUser, [character]);

      const players = store.getPlayersInZone('zone1');
      const runtimeChar = players[0].characters[0];

      expect(runtimeChar.class).toBe(CharacterClass.FIGHTER);
    });
  });

  describe('removePlayerFromZone', () => {
    it('should return zoneId and userId when removing player', async () => {
      const socket = createMockSocket();
      const character = createMockCharacter();

      await store.addPlayerToZone('zone1', socket, mockUser, [character]);
      const result = store.removePlayerFromZone(socket);

      expect(result).toEqual({ zoneId: 'zone1', userId: mockUser.id });
    });

    it('should return null when socket has no user', () => {
      const socket = { data: {} } as unknown as Socket;
      const result = store.removePlayerFromZone(socket);
      expect(result).toBeNull();
    });
  });
});
