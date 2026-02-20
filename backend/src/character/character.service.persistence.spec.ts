import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CharacterService } from './character.service';
import { Character } from './character.entity';
import { InventoryService } from '../inventory/inventory.service';
import { PlayerStateStore } from '../game/stores/player-state.store';
import { BroadcastService } from '../game/broadcast.service';
import { CharacterClassService } from '../character-class/character-class.service';

describe('CharacterService - saveCharacterPositions', () => {
  let service: CharacterService;
  let mockRepository: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockRepository = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterService,
        { provide: getRepositoryToken(Character), useValue: mockRepository },
        { provide: InventoryService, useValue: {} },
        { provide: PlayerStateStore, useValue: {} },
        { provide: BroadcastService, useValue: {} },
        { provide: CharacterClassService, useValue: {} },
      ],
    }).compile();

    service = module.get<CharacterService>(CharacterService);
  });

  it('should return early without DB calls when updates array is empty', async () => {
    await service.saveCharacterPositions([]);

    expect(mockRepository.update).not.toHaveBeenCalled();
  });

  it('should call repository.update for each character in the updates array', async () => {
    const updates = [
      { characterId: 'char-1', positionX: 100, positionY: 200, currentZoneId: 'zone1' },
      { characterId: 'char-2', positionX: 300, positionY: 400, currentZoneId: 'zone1' },
      { characterId: 'char-3', positionX: 500, positionY: 600, currentZoneId: 'zone2' },
    ];

    await service.saveCharacterPositions(updates);

    expect(mockRepository.update).toHaveBeenCalledTimes(3);
    expect(mockRepository.update).toHaveBeenCalledWith('char-1', {
      positionX: 100,
      positionY: 200,
      currentZoneId: 'zone1',
    });
    expect(mockRepository.update).toHaveBeenCalledWith('char-2', {
      positionX: 300,
      positionY: 400,
      currentZoneId: 'zone1',
    });
    expect(mockRepository.update).toHaveBeenCalledWith('char-3', {
      positionX: 500,
      positionY: 600,
      currentZoneId: 'zone2',
    });
  });

  it('should call repository.update for a single character', async () => {
    const updates = [
      { characterId: 'char-1', positionX: 42, positionY: 84, currentZoneId: 'startZone' },
    ];

    await service.saveCharacterPositions(updates);

    expect(mockRepository.update).toHaveBeenCalledTimes(1);
    expect(mockRepository.update).toHaveBeenCalledWith('char-1', {
      positionX: 42,
      positionY: 84,
      currentZoneId: 'startZone',
    });
  });

  it('should handle errors gracefully without throwing', async () => {
    mockRepository.update.mockRejectedValue(new Error('DB connection lost'));

    const updates = [
      { characterId: 'char-1', positionX: 100, positionY: 200, currentZoneId: 'zone1' },
    ];

    // Should not throw
    await expect(service.saveCharacterPositions(updates)).resolves.toBeUndefined();
  });

  it('should handle partial failures in Promise.all gracefully', async () => {
    // First call succeeds, second fails
    mockRepository.update
      .mockResolvedValueOnce({ affected: 1 })
      .mockRejectedValueOnce(new Error('Constraint violation'));

    const updates = [
      { characterId: 'char-1', positionX: 100, positionY: 200, currentZoneId: 'zone1' },
      { characterId: 'char-2', positionX: 300, positionY: 400, currentZoneId: 'zone1' },
    ];

    // The method catches errors and does not throw
    await expect(service.saveCharacterPositions(updates)).resolves.toBeUndefined();
  });
});
