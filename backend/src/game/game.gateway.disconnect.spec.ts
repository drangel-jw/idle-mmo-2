import { Test, TestingModule } from '@nestjs/testing';
import { GameGateway } from './game.gateway';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { CharacterService } from '../character/character.service';
import { ZoneService } from './zone.service';
import { GameLoopService } from './game-loop.service';
import { BroadcastService } from './broadcast.service';
import { PlayerStateStore, RuntimeCharacterData } from './stores/player-state.store';
import { EnemyStateStore } from './stores/enemy-state.store';
import { DroppedItemStore } from './stores/dropped-item.store';
import { SpellQueueStore } from './stores/spell-queue.store';
import { InventoryService } from '../inventory/inventory.service';
import { AbilityService } from '../abilities/ability.service';
import { CombatService } from './combat.service';
import { User } from '../user/user.entity';
import { Socket, Server } from 'socket.io';
import { CharacterClass } from '../common/enums/character-class.enum';

describe('GameGateway - handleDisconnect position save', () => {
  let gateway: GameGateway;

  const mockCharacterService = {
    findCharacterByIdAndUserId: jest.fn(),
    saveCharacterPositions: jest.fn().mockResolvedValue(undefined),
  };
  const mockPlayerStateStore = {
    addPlayerToZone: jest.fn(),
    removePlayerFromZone: jest.fn(),
    getPlayersInZone: jest.fn(),
    setCharacterTargetPosition: jest.fn(),
    getPlayerCharacters: jest.fn(),
    getZoneCharacterStates: jest.fn(),
    setAttackTarget: jest.fn(),
    setMovementTarget: jest.fn(),
    setCharacterLootTarget: jest.fn(),
    setCharacterLootArea: jest.fn(),
    getPlayerCharactersInZone: jest.fn().mockReturnValue([]),
    ensureZone: jest.fn(),
  };

  const mockUser: User = {
    id: 'user-1',
    username: 'TestUser',
    passwordHash: 'hashed',
    characters: [],
    inventoryItems: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const createMockSocket = (overrides: Partial<{ user: User; currentZoneId: string }> = {}): Socket => {
    const socket = {
      id: 'socket-1',
      data: {
        user: overrides.user ?? mockUser,
        currentZoneId: overrides.currentZoneId ?? 'zone1',
      },
      join: jest.fn(),
      leave: jest.fn(),
    } as unknown as Socket;
    return socket;
  };

  const createMockRuntimeChar = (overrides: Partial<RuntimeCharacterData> = {}): RuntimeCharacterData => ({
    id: 'char-1',
    name: 'Hero',
    userId: mockUser.id,
    user: mockUser,
    ownerId: mockUser.id,
    ownerName: mockUser.username,
    baseHealth: 100,
    currentHealth: 80,
    baseAttack: 10,
    baseDefense: 5,
    effectiveAttack: 12,
    effectiveDefense: 7,
    positionX: 250,
    positionY: 350,
    anchorX: 100,
    anchorY: 100,
    leashDistance: 400,
    state: 'idle',
    attackTargetId: null,
    targetItemId: null,
    commandState: null,
    targetX: null,
    targetY: null,
    attackRange: 50,
    attackSpeed: 1500,
    lastAttackTime: 0,
    aggroRange: 150,
    timeOfDeath: null,
    level: 5,
    xp: 100,
    currentZoneId: 'zone1',
    createdAt: new Date(),
    updatedAt: new Date(),
    class: CharacterClass.FIGHTER,
    ...overrides,
  } as RuntimeCharacterData);

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameGateway,
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        { provide: UserService, useValue: { findOneById: jest.fn() } },
        { provide: CharacterService, useValue: mockCharacterService },
        { provide: ZoneService, useValue: { createZone: jest.fn(), getActiveZoneIds: jest.fn().mockReturnValue([]) } },
        { provide: PlayerStateStore, useValue: mockPlayerStateStore },
        { provide: EnemyStateStore, useValue: { getEnemyInstanceById: jest.fn(), ensureZone: jest.fn() } },
        { provide: DroppedItemStore, useValue: { ensureZone: jest.fn(), getDroppedItemById: jest.fn() } },
        { provide: SpellQueueStore, useValue: { ensureZone: jest.fn() } },
        { provide: GameLoopService, useValue: { startLoop: jest.fn() } },
        { provide: InventoryService, useValue: {} },
        { provide: BroadcastService, useValue: { setServerInstance: jest.fn() } },
        { provide: AbilityService, useValue: {} },
        { provide: CombatService, useValue: {} },
      ],
    }).compile();

    gateway = module.get<GameGateway>(GameGateway);
    // Set up mock server so handleDisconnect can call server.to().emit()
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    } as unknown as Server;
  });

  it('should capture zoneId before cleanup and save positions with correct zoneId', () => {
    const socket = createMockSocket({ currentZoneId: 'forestZone' });
    const characters = [
      createMockRuntimeChar({ id: 'char-1', positionX: 250, positionY: 350 }),
      createMockRuntimeChar({ id: 'char-2', positionX: 400, positionY: 500 }),
    ];
    mockPlayerStateStore.getPlayerCharacters.mockReturnValue(characters);
    mockPlayerStateStore.removePlayerFromZone.mockReturnValue({ zoneId: 'forestZone', userId: mockUser.id });

    gateway.handleDisconnect(socket);

    // Verify saveCharacterPositions was called with the correct zoneId
    expect(mockCharacterService.saveCharacterPositions).toHaveBeenCalledWith([
      { characterId: 'char-1', positionX: 250, positionY: 350, currentZoneId: 'forestZone' },
      { characterId: 'char-2', positionX: 400, positionY: 500, currentZoneId: 'forestZone' },
    ]);
  });

  it('should filter out characters with null positions', () => {
    const socket = createMockSocket({ currentZoneId: 'zone1' });
    const characters = [
      createMockRuntimeChar({ id: 'char-1', positionX: 250, positionY: 350 }),
      createMockRuntimeChar({ id: 'char-2', positionX: null as any, positionY: 350 }),
    ];
    mockPlayerStateStore.getPlayerCharacters.mockReturnValue(characters);
    mockPlayerStateStore.removePlayerFromZone.mockReturnValue({ zoneId: 'zone1', userId: mockUser.id });

    gateway.handleDisconnect(socket);

    expect(mockCharacterService.saveCharacterPositions).toHaveBeenCalledWith([
      { characterId: 'char-1', positionX: 250, positionY: 350, currentZoneId: 'zone1' },
    ]);
  });

  it('should not call saveCharacterPositions when there are no characters', () => {
    const socket = createMockSocket({ currentZoneId: 'zone1' });
    mockPlayerStateStore.getPlayerCharacters.mockReturnValue(undefined);
    mockPlayerStateStore.removePlayerFromZone.mockReturnValue({ zoneId: 'zone1', userId: mockUser.id });

    gateway.handleDisconnect(socket);

    expect(mockCharacterService.saveCharacterPositions).not.toHaveBeenCalled();
  });

  it('should not call saveCharacterPositions when no user on socket', () => {
    const socket = {
      id: 'socket-1',
      data: {},
    } as unknown as Socket;
    mockPlayerStateStore.removePlayerFromZone.mockReturnValue(null);

    gateway.handleDisconnect(socket);

    expect(mockCharacterService.saveCharacterPositions).not.toHaveBeenCalled();
  });

  it('should use fallback zoneId "startZone" when currentZoneId is not set on socket', () => {
    const socket = {
      id: 'socket-1',
      data: {
        user: mockUser,
        // currentZoneId is NOT set
      },
    } as unknown as Socket;
    const characters = [
      createMockRuntimeChar({ id: 'char-1', positionX: 100, positionY: 200 }),
    ];
    mockPlayerStateStore.getPlayerCharacters.mockReturnValue(characters);
    mockPlayerStateStore.removePlayerFromZone.mockReturnValue({ zoneId: 'startZone', userId: mockUser.id });

    gateway.handleDisconnect(socket);

    // When zoneId is undefined, the code uses `zoneId || 'startZone'`
    expect(mockCharacterService.saveCharacterPositions).toHaveBeenCalledWith([
      { characterId: 'char-1', positionX: 100, positionY: 200, currentZoneId: 'startZone' },
    ]);
  });

  it('should clean up moveCommandTimestamps rate limit entry on disconnect', () => {
    const socket = createMockSocket({ currentZoneId: 'zone1' });
    mockPlayerStateStore.getPlayerCharacters.mockReturnValue([]);
    mockPlayerStateStore.removePlayerFromZone.mockReturnValue({ zoneId: 'zone1', userId: mockUser.id });

    // Access the private map to set up the rate limit entry
    const rateLimitMap = (gateway as any).moveCommandTimestamps as Map<string, number>;
    rateLimitMap.set(mockUser.id, Date.now());
    expect(rateLimitMap.has(mockUser.id)).toBe(true);

    gateway.handleDisconnect(socket);

    expect(rateLimitMap.has(mockUser.id)).toBe(false);
  });

  it('should call removePlayerFromZone after saving positions', () => {
    const socket = createMockSocket({ currentZoneId: 'zone1' });
    const characters = [createMockRuntimeChar({ id: 'char-1', positionX: 100, positionY: 200 })];
    mockPlayerStateStore.getPlayerCharacters.mockReturnValue(characters);
    mockPlayerStateStore.removePlayerFromZone.mockReturnValue({ zoneId: 'zone1', userId: mockUser.id });

    gateway.handleDisconnect(socket);

    // Both should be called
    expect(mockCharacterService.saveCharacterPositions).toHaveBeenCalled();
    expect(mockPlayerStateStore.removePlayerFromZone).toHaveBeenCalledWith(socket);
  });

  it('should broadcast playerLeft event after removal', () => {
    const socket = createMockSocket({ currentZoneId: 'zone1' });
    mockPlayerStateStore.getPlayerCharacters.mockReturnValue([]);
    mockPlayerStateStore.removePlayerFromZone.mockReturnValue({ zoneId: 'zone1', userId: mockUser.id });

    gateway.handleDisconnect(socket);

    const mockTo = gateway.server.to as jest.Mock;
    expect(mockTo).toHaveBeenCalledWith('zone1');
    const mockEmit = mockTo.mock.results[0].value.emit;
    expect(mockEmit).toHaveBeenCalledWith('playerLeft', { playerId: mockUser.id });
  });

  it('should handle saveCharacterPositions errors gracefully (fire-and-forget)', () => {
    const socket = createMockSocket({ currentZoneId: 'zone1' });
    const characters = [createMockRuntimeChar({ id: 'char-1', positionX: 100, positionY: 200 })];
    mockPlayerStateStore.getPlayerCharacters.mockReturnValue(characters);
    mockPlayerStateStore.removePlayerFromZone.mockReturnValue({ zoneId: 'zone1', userId: mockUser.id });
    mockCharacterService.saveCharacterPositions.mockRejectedValueOnce(new Error('DB error'));

    // Should not throw
    expect(() => gateway.handleDisconnect(socket)).not.toThrow();
  });
});
