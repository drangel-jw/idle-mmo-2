// frontend/src/scenes/CharacterSelectScene.ts
import Phaser from 'phaser';
import { NetworkManager, CharacterClassTemplateData } from '../network/NetworkManager';
import { EventBus } from '../EventBus';
// --- Import the new component --- 
import { CharacterCardComponent, CharacterCardData } from '../components/CharacterCardComponent';
// ------------------------------

// Define an interface for the character data we expect from the backend
interface CharacterData {
    id: string;
    name: string;
    level: number;
    class: string;
    // Add other relevant fields later (e.g., class, appearance)
}

export default class CharacterSelectScene extends Phaser.Scene {
    private characters: CharacterData[] = [];
    private selectedCharacterIds = new Set<string>(); // Keep using Set for selected IDs
    private readonly MAX_SELECTED_CHARACTERS = 3;
    private availableClasses: CharacterClassTemplateData[] = [];
    private selectedClassId: string | null = null; // Keep for creation modal
    
    // --- Store Component Instances ---
    private characterCardComponents: Map<string, CharacterCardComponent> = new Map();
    private classCardComponents: Map<string, CharacterCardComponent> = new Map();
    // -------------------------------

    // Stable bound references for modal event listeners (needed for removeEventListener)
    private boundHideModal = this.hideCreateCharacterModal.bind(this);
    private boundHandleCreate = this.handleCreateCharacter.bind(this);
    private boundUpdateModalButton = this.updateModalCreateButtonState.bind(this);

    // UI Elements
    // private characterListText: Phaser.GameObjects.Text[] = []; // REMOVE old text list
    private characterListContainer!: Phaser.GameObjects.DOMElement; // Scroll container
    private enterGameButton!: Phaser.GameObjects.DOMElement;
    private statusText!: Phaser.GameObjects.Text;
    private showCreateModalButton!: Phaser.GameObjects.DOMElement;
    private createModalContainer!: Phaser.GameObjects.DOMElement;
    private modalBgGraphics: Phaser.GameObjects.Graphics | null = null; // Legacy — no longer used for dimming

    constructor() {
        super('CharacterSelectScene');
    }

    create() {
        // --- Scene Setup --- 
        console.log("CharacterSelectScene create");
        const { width, height } = this.scale;
        const centerW = width / 2;
        const centerH = height / 2;

        // --- Revert to Grey Background --- 
        this.cameras.main.setBackgroundColor('#3d3d3d'); 
        // ---------------------------------

        // Title
        this.add.text(centerW, 50, 'Select Your Party', { 
            fontSize: '32px', 
            color: '#fff', 
            stroke: '#000', 
            strokeThickness: 4 
        }).setOrigin(0.5);

        // --- Create Scrollable Container for Character List --- 
        const listStartY = 100; // Position below title
        const listHeight = 220; // Increased height for cards+text
        this.characterListContainer = this.add.dom(centerW, listStartY + listHeight / 2).createFromHTML(`
            <div id="character-scroll-container" style="
                width: ${width * 0.85}px; /* 85% of game width */
                height: ${listHeight}px;
                overflow-x: auto; /* Enable horizontal scroll */
                overflow-y: hidden; /* Disable vertical scroll */
                display: flex; /* Arrange cards horizontally */
                flex-wrap: nowrap; /* Prevent wrapping */
                align-items: center; 
                padding: 15px;
                border: 1px solid #555;
                background-color: rgba(0,0,0,0.3);
                gap: 20px; /* Space between cards */
                scrollbar-width: thin; /* Firefox scrollbar */
                scrollbar-color: #888 #333; /* Firefox scrollbar */
            ">
                <!-- Character cards will be added here -->
            </div>
        `);
        // Add styles for Webkit scrollbars (Chrome, Safari, Edge)
        const styleSheet = document.createElement("style");
        styleSheet.textContent = `
            #character-scroll-container::-webkit-scrollbar {
                height: 8px;
            }
            #character-scroll-container::-webkit-scrollbar-track {
                background: #333;
                border-radius: 4px;
            }
            #character-scroll-container::-webkit-scrollbar-thumb {
                background-color: #888;
                border-radius: 4px;
                border: 2px solid #333;
            }
            #character-scroll-container::-webkit-scrollbar-thumb:hover {
                background-color: #aaa;
            }
        `;
        document.head.appendChild(styleSheet);
        // ----------------------------------------------------

        // Status Text
        this.statusText = this.add.text(centerW, listStartY + listHeight + 35, '', { 
            fontSize: '16px', 
            color: '#ffffff', 
            align: 'center' 
        }).setOrigin(0.5);

        // --- Buttons --- 
        const bottomAreaY = listStartY + listHeight + 90;
        this.showCreateModalButton = this.add.dom(centerW - 120, bottomAreaY).createFromHTML(`
            <button name="showCreate" style="width: 180px; padding: 10px; font-size: 14px;">Create New Character</button>
        `);
        this.showCreateModalButton.addListener('click');
        this.showCreateModalButton.on('click', () => {
            this.showCreateCharacterModal();
        });
        this.enterGameButton = this.add.dom(centerW + 120, bottomAreaY).createFromHTML(`
            <button name="enter" style="width: 180px; padding: 10px; font-size: 14px; background-color: #4CAF50; color: white;">Enter Game</button>
        `);
        this.enterGameButton.addListener('click');
        this.enterGameButton.on('click', () => {
            this.handleEnterGame();
        });
        this.toggleEnterGameButton(false); // Initially disabled

        // --- Modal Container ---
        // Phaser DOM elements size from their root element's explicit dimensions.
        // We use the game canvas size for the overlay and compute the class area height
        // from remaining space so everything fits without flex sizing issues.
        const modalHeight = Math.floor(height * 0.85);
        const classAreaHeight = modalHeight - 310; // padding(50) + h2(52) + name input(53) + label(30) + wrapper margin(20) + buttons(50) + buffer
        this.createModalContainer = this.add.dom(centerW, centerH).setOrigin(0.5, 0.5).createFromHTML(`
            <div id="create-modal-overlay" style="
                width: ${width}px;
                height: ${height}px;
                background-color: rgba(0,0,0,0.75);
                display: flex;
                align-items: center;
                justify-content: center;
            ">
              <div id="create-modal" style="
                  width: 800px;
                  max-width: 90%;
                  height: ${modalHeight}px;
                  padding: 25px;
                  background-color: #282c34;
                  border-radius: 10px;
                  box-shadow: 0 5px 15px rgba(0,0,0,0.5);
                  color: #fff;
                  border: 1px solid #555;
                  box-sizing: border-box;
                  overflow: hidden;
              ">
                  <h2 style="text-align: center; margin-top: 0; margin-bottom: 20px;">Create New Character</h2>

                  <div style="margin-bottom: 15px;">
                     <label for="modalCharName" style="display: block; margin-bottom: 5px;">Name:</label>
                     <input type="text" id="modalCharName" name="charName" required minlength="3" maxlength="50"
                             style="width: 95%; padding: 10px; font-size: 16px; border-radius: 5px; border: 1px solid #ccc; background-color: #444; color: #fff;">
                  </div>

                  <!-- Class Selection Container -->
                  <div style="margin-bottom: 20px;">
                      <label style="display: block; margin-bottom: 10px;">Select Class:</label>
                      <div id="modal-class-select-container" style="
                          display: flex;
                          flex-wrap: wrap;
                          gap: 15px;
                          justify-content: center;
                          align-content: flex-start;
                          padding: 10px;
                          border: 1px dashed #555;
                          border-radius: 5px;
                          height: ${classAreaHeight}px;
                          overflow-y: auto;
                          box-sizing: border-box;
                          scrollbar-width: thin;
                          scrollbar-color: #888 #333;
                          ">
                          <!-- Class cards go here -->
                      </div>
                  </div>

                  <!-- Buttons -->
                  <div style="text-align: center; padding-top: 10px;">
                       <button id="modal-cancel-button" style="padding: 10px 20px; margin-right: 15px; cursor: pointer;">Cancel</button>
                       <button id="modal-create-button" style="padding: 10px 20px; cursor: pointer; background-color: #888; color: #ccc; border: none; border-radius: 3px;" disabled>Create</button>
                  </div>
              </div>
            </div>
          `);
          
          // --- Set parent container initially invisible ---
          this.createModalContainer.setDepth(10);
          this.createModalContainer.setVisible(false); 
          // -----------------------------------------------
          
          // Add scrollbar styles
          const modalStyleSheet = document.createElement("style");
          modalStyleSheet.textContent = `
            #modal-class-select-container::-webkit-scrollbar {
                width: 8px;
            }
            #modal-class-select-container::-webkit-scrollbar-track {
                background: #333;
                border-radius: 4px;
            }
            #modal-class-select-container::-webkit-scrollbar-thumb {
                background-color: #888;
                border-radius: 4px;
                border: 2px solid #333;
            }
            #modal-class-select-container::-webkit-scrollbar-thumb:hover {
                background-color: #aaa;
            }
        `;
        document.head.appendChild(modalStyleSheet);

        this.resetModalState();
        
        // --- Fetch Initial Data --- 
        this.fetchCharacters();
        this.fetchAndDisplayClasses(); 
    }

    setStatus(message: string, isError: boolean = false) {
        this.statusText.setText(message);
        this.statusText.setColor(isError ? '#ff0000' : '#ffffff');
    }

    async fetchCharacters() {
        this.setStatus('Loading characters...', false);
        const token = localStorage.getItem('jwtToken');
        if (!token) {
            this.setStatus('Authentication error. Please log in again.', true);
            // Optionally redirect to login scene after a delay
            this.time.delayedCall(2000, () => this.scene.start('LoginScene'));
            return;
        }

        try {
            const response = await fetch('http://localhost:3000/characters', //'http://141.155.171.22:3000/auth/login', 
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });

            if (!response.ok) {
                 const errorData = await response.json();
                throw new Error(errorData.message || `Failed to fetch characters (${response.status})`);
            }

            this.characters = await response.json() as CharacterData[];
            // --- Don't display immediately --- 
            // this.displayCharacters(); 
            // -------------------------------
            this.setStatus(''); 
            // --- Call helper to check if ready to display --- 
            this.tryDisplayCharacters();
            // ----------------------------------------------

        } catch (error: any) {
            console.error('Fetch Characters Error:', error);
            this.setStatus(error.message || 'Failed to load characters.', true);
             if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                 // Token might be invalid/expired
                 localStorage.removeItem('jwtToken');
                 this.time.delayedCall(2000, () => this.scene.start('LoginScene'));
             }
        }
    }

    async fetchAndDisplayClasses() {
        this.setStatus('Loading classes...', false);
        try {
            this.availableClasses = await NetworkManager.getInstance().getAvailableClasses();
            // --- Don't assume characters are ready --- 
            // this.setStatus(''); 
            // ---------------------------------------
            // --- Call helper to check if ready to display --- 
            this.tryDisplayCharacters();
            // ----------------------------------------------
        } catch (error: any) {
            console.error('Fetch Classes Error:', error);
            this.setStatus(error.message || 'Failed to load classes.', true);
            // Handle error appropriately, maybe disable creation
        }
    }

    // --- NEW Helper Function --- 
    tryDisplayCharacters() {
        // Only display if BOTH datasets are loaded
        if (this.characters.length > 0 && this.availableClasses.length > 0) {
            console.log("Character and Class data loaded. Displaying character list.");
            this.displayCharacters();
            // Clear status ONLY when display happens
            this.setStatus(''); 
        } else {
            // Log status if waiting
            console.log("Waiting for both characters and classes data...");
            if(this.characters.length === 0) console.log(" - Characters pending...");
            if(this.availableClasses.length === 0) console.log(" - Classes pending...");
            // Keep the loading status message if not ready
        }
    }
    // -------------------------

    displayCharacters() {
        const scrollContainer = this.characterListContainer.node.querySelector('#character-scroll-container') as HTMLElement;
        if (!scrollContainer) {
            console.error("Character scroll container not found!");
            return;
        }

        // Clear previous content & components
        scrollContainer.innerHTML = ''; 
        this.characterCardComponents.forEach(comp => comp.stopAnimationAndReset()); // Stop anim before removing
        this.characterCardComponents.clear();
        // No need to clear animationFrameCounts map here, component doesn't use it directly

        if (this.characters.length === 0) {
             scrollContainer.innerHTML = '<div style="color: #ccc; text-align: center; width: 100%; align-self: center;">No characters found. Create one!</div>';
             this.toggleEnterGameButton(false);
             return;
        }

        const classDataMap = new Map(this.availableClasses.map(c => [c.classId, c]));

        this.characters.forEach(char => {
            const charClassData = classDataMap.get(char.class);
            if (!charClassData) {
                console.warn(`Class data not found for character ${char.name} with class ${char.class}`);
                // Optionally display a placeholder or skip
                return; 
            }

            // --- Create Component Data --- 
            const cardData: CharacterCardData = {
                id: char.id,
                name: char.name,
                levelText: `Lv ${char.level} ${charClassData.name}`,
                spritePaths: {
                    idle: `assets/sprites/characters/${charClassData.spriteKeyBase.toLowerCase()}/idle.png`,
                    attack: `assets/sprites/characters/${charClassData.spriteKeyBase.toLowerCase()}/attack.png`,
                    walk: `assets/sprites/characters/${charClassData.spriteKeyBase.toLowerCase()}/walk.png`,
                },
                initialIsSelected: this.selectedCharacterIds.has(char.id)
            };
            // ---------------------------

            // --- Create and Store Component --- 
            const component = new CharacterCardComponent(
                scrollContainer, // Parent element
                cardData,
                (characterId: string) => this.handleCharacterSelection(characterId) // Click handler
            );
            this.characterCardComponents.set(char.id, component);
            // ----------------------------------
        });
        
        this.toggleEnterGameButton(this.selectedCharacterIds.size > 0);
    }

    // --- NEW Character Selection Handler --- 
    handleCharacterSelection(characterId: string) {
        const wasSelected = this.selectedCharacterIds.has(characterId);
        
        if (wasSelected) {
            this.selectedCharacterIds.delete(characterId);
            console.log(`Scene: Deselected char ${characterId}`);
        } else {
            if (this.selectedCharacterIds.size < this.MAX_SELECTED_CHARACTERS) {
                this.selectedCharacterIds.add(characterId);
                console.log(`Scene: Selected char ${characterId}`);
            } else {
                this.setStatus(`You can only select up to ${this.MAX_SELECTED_CHARACTERS} characters.`, true);
                this.time.delayedCall(1500, () => this.setStatus('')); 
                return; // Prevent selection state change
            }
        }

        // Update ALL character components based on the new selection set
        this.characterCardComponents.forEach((component, id) => {
            component.setSelected(this.selectedCharacterIds.has(id));
        });

        this.toggleEnterGameButton(this.selectedCharacterIds.size > 0);
    }
    // ---------------------------------------

    toggleEnterGameButton(enabled: boolean) {
        const buttonElement = (this.enterGameButton.node as HTMLElement).querySelector('button');
        if (buttonElement) {
            buttonElement.disabled = !enabled;
            buttonElement.style.backgroundColor = enabled ? '#4CAF50' : '#888'; // Green when enabled, grey when disabled
            buttonElement.style.cursor = enabled ? 'pointer' : 'not-allowed';
        }
    }

    async handleCreateCharacter() {
        // This is now triggered by the MODAL's create button
        const modalElement = this.createModalContainer.node.querySelector('#create-modal') as HTMLElement;
        if (!modalElement) return; // Should not happen if button is clickable

        const inputElement = modalElement.querySelector('#modalCharName') as HTMLInputElement | null;
        
        // Class selection check remains
        if (!this.selectedClassId) {
            this.setStatus('Please select a class for the new character.', true);
            return;
        }

        // Input element check
        if (!inputElement) {
            console.error('Cannot find character name input element in modal.');
            this.setStatus('Internal error creating character.', true);
            return;
        }

        const name = inputElement.value.trim();
        // Name validation checks remain
        if (!name) {
            this.setStatus('Please enter a name for the new character.', true);
            return;
        }
        if (name.length < 3 || name.length > 50) {
             this.setStatus('Character name must be between 3 and 50 characters.', true);
             return;
         }

        this.setStatus('Creating character...', false);
        
        // Disable modal's create button during request
        const createBtnElement = modalElement.querySelector('#modal-create-button') as HTMLButtonElement;
        if(createBtnElement) createBtnElement.disabled = true;

        const token = localStorage.getItem('jwtToken');
        if (!token) {
            this.setStatus('Authentication error. Please log in again.', true);
             if(createBtnElement) createBtnElement.disabled = false; // Re-enable button
            this.time.delayedCall(2000, () => this.scene.start('LoginScene'));
            return;
        }

        try {
            const response = await fetch(`${NetworkManager.getInstance()['apiBaseUrl']}/characters`, // Use NM's base URL
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name, classId: this.selectedClassId }), // Send selected classId
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || `Failed to create character (${response.status})`);
            }

            // Creation successful
            this.setStatus(`Character '${name}' created!`, false);
            this.hideCreateCharacterModal(); // Close the modal
            // No need to reset modal state here, resetModalState called on show
            await this.fetchCharacters(); // Re-fetch character list

        } catch (error: any) {
            console.error('Create Character Error:', error);
            this.setStatus(error.message || 'Failed to create character.', true);
        } finally {
             if(createBtnElement) createBtnElement.disabled = false; // Re-enable modal button if needed (though modal closes)
        }
    }

    handleEnterGame() {
        if (this.selectedCharacterIds.size === 0) {
            this.setStatus('Please select at least one character.', true);
            return;
        }

        const selectedIds = Array.from(this.selectedCharacterIds);
        console.log('Selected Character IDs:', selectedIds);
        this.setStatus('Selecting party...', false);

        // Send selection to server via WebSocket
        const networkManager = NetworkManager.getInstance();
        if (!networkManager.isConnected()) {
            this.setStatus('Not connected to server. Please try again or login.', true);
            // Optionally try to reconnect or go to login
            return;
        }

        networkManager.sendMessage('selectParty', { characterIds: selectedIds }, (response: {success: boolean, characters: any[]}) => {
            // This callback executes when the server acknowledges the message
            if (response && response.success) {
                console.log('Server confirmed party selection:', response.characters);
                 this.setStatus(''); // Clear status
                 // Transition to LoadScene, which will handle world generation before GameScene
                 this.scene.start('LoadScene', { selectedParty: response.characters });
            } else {
                 console.error('Server failed to select party:', response);
                 this.setStatus('Server error selecting party. Please try again.', true);
                 // Keep the user on this scene
            }
        });
    }

    // +++ Add Modal Show/Hide Functions +++
    showCreateCharacterModal() {
        // --- Show the Modal Container (overlay is part of the DOM) ---
        this.createModalContainer.setVisible(true);
        
        // Reset state, populate UI, add listeners
        const modalElement = this.createModalContainer.node.querySelector('#create-modal') as HTMLElement;
        if (modalElement) {
            this.resetModalState(); 
            this.displayClassSelectionUI(); 
            this.updateModalCreateButtonState(); 

            const cancelButton = modalElement.querySelector('#modal-cancel-button') as HTMLButtonElement;
            const createButton = modalElement.querySelector('#modal-create-button') as HTMLButtonElement;
            const nameInput = modalElement.querySelector('#modalCharName') as HTMLInputElement;

            cancelButton?.removeEventListener('click', this.boundHideModal);
            cancelButton?.addEventListener('click', this.boundHideModal);

            createButton?.removeEventListener('click', this.boundHandleCreate);
            createButton?.addEventListener('click', this.boundHandleCreate);

            nameInput?.removeEventListener('input', this.boundUpdateModalButton);
            nameInput?.addEventListener('input', this.boundUpdateModalButton);
        } else {
            console.error("Could not find #create-modal element for listeners.");
        }
    }

    hideCreateCharacterModal() {
        this.createModalContainer.setVisible(false);
    }

    resetModalState() {
        this.selectedClassId = null;
        const modalElement = this.createModalContainer.node.querySelector('#create-modal') as HTMLElement;
        if (modalElement) {
            const nameInput = modalElement.querySelector('#modalCharName') as HTMLInputElement;
            if(nameInput) nameInput.value = '';
            const classContainer = modalElement.querySelector('#modal-class-select-container') as HTMLElement;
            if (classContainer) {
                classContainer.querySelectorAll('div.class-card').forEach(el => {
                    (el as HTMLElement).style.borderColor = '#ccc';
                    (el as HTMLElement).style.backgroundColor = '#666'; 
                });
            }
        }
    }

    // +++ Add Function to Update Modal Create Button State +++
    updateModalCreateButtonState() {
        const modalElement = this.createModalContainer.node.querySelector('#create-modal') as HTMLElement;
        if (!modalElement) return;

        const nameInput = modalElement.querySelector('#modalCharName') as HTMLInputElement;
        const createButton = modalElement.querySelector('#modal-create-button') as HTMLButtonElement;
        
        const nameIsValid = nameInput && nameInput.value.trim().length >= 3 && nameInput.value.trim().length <= 50;
        const classIsSelected = !!this.selectedClassId;
        const shouldBeEnabled = nameIsValid && classIsSelected;

        if (createButton) {
            createButton.disabled = !shouldBeEnabled;
            createButton.style.backgroundColor = shouldBeEnabled ? '#4CAF50' : '#888';
            createButton.style.color = shouldBeEnabled ? 'white' : '#ccc';
            createButton.style.cursor = shouldBeEnabled ? 'pointer' : 'not-allowed';
        }
    }

    displayClassSelectionUI() { 
        const container = this.createModalContainer.node.querySelector('#modal-class-select-container') as HTMLElement;
        if (!container) {
            console.error('Modal class selection container not found!');
            return;
        }
        container.innerHTML = ''; 
        // --- Reset Class Components --- 
        this.classCardComponents.forEach(comp => comp.stopAnimationAndReset());
        this.classCardComponents.clear();
        // ----------------------------
        console.log(`Displaying ${this.availableClasses.length} classes in modal.`);

        this.availableClasses.forEach(charClass => {
            // --- Create Component Data for Class --- 
            const cardData: CharacterCardData = {
                id: charClass.classId, // Use classId as ID
                name: charClass.name,
                levelText: undefined, // No level for class selection
                spritePaths: {
                    idle: `assets/sprites/characters/${charClass.spriteKeyBase.toLowerCase()}/idle.png`,
                    attack: `assets/sprites/characters/${charClass.spriteKeyBase.toLowerCase()}/attack.png`,
                    walk: `assets/sprites/characters/${charClass.spriteKeyBase.toLowerCase()}/walk.png`,
                },
                initialIsSelected: this.selectedClassId === charClass.classId
            };
             // Add description to the card data if needed, or handle separately
             // cardData.description = charClass.description; 
            // -------------------------------------

            // --- Create and Store Class Component --- 
            const component = new CharacterCardComponent(
                container, 
                cardData, 
                (classId: string) => this.handleClassSelection(classId) // Click handler
            );
             this.classCardComponents.set(charClass.classId, component);
             // --- Add description AFTER component element exists --- 
             // (Component doesn't handle description currently)
             const descElement = document.createElement('div');
             descElement.textContent = charClass.description;
             descElement.style.fontSize = '11px';
             descElement.style.marginTop = '5px'; // Add some space
             component.getElement().appendChild(descElement);
             // --------------------------------------------------
        });
    }

    // --- NEW Class Selection Handler --- 
    handleClassSelection(classId: string) {
        if (this.selectedClassId === classId) {
             // Optionally allow deselecting class? If not, just return.
             // this.selectedClassId = null;
             return; 
        }
        this.selectedClassId = classId;
        console.log(`Scene: Selected class ${classId}`);

        // Update ALL class components
        this.classCardComponents.forEach((component, id) => {
            component.setSelected(this.selectedClassId === id);
        });
        
        this.updateModalCreateButtonState();
    }
    // ---------------------------------
}