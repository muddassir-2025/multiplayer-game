/** * GAME CONFIGURATION
 * Configures the Phaser engine, physics, and main scene hooks.
 */
const config = {
    type: Phaser.AUTO,

    scale: {
        mode: Phaser.Scale.FIT, // Stretches to fit
        autoCenter: Phaser.Scale.CENTER_BOTH, // Centers game on screen
        width: 1280,
        height: 720
    },
    physics: {
        default: 'arcade',
        arcade: { gravity: { y: 1000 }, debug: false }
    },
    scene: { preload, create, update }
};

const game = new Phaser.Game(config);

// --- GLOBAL VARIABLES ---
let player, cursors, spaceKey, enterKey, ground;
let score = 0;
let bullets = 10;
let health = 150;
let flytime = 1200;
let isInvincible = false;

// Groups for object pooling and collision management

let spikes, bricks, items, enemy, bulletGroup;
// let scoretext, flyText, bullettext, healthtext; // REMOVED: Using DOM HUD

// Gameplay Variables
let lastDash = 0;
let comboCount = 0;
let comboTimer = 0;
let shiftKey;
let zerokey;
let isDashing = false;
let isblast = false;
let blastTimer = 0;
let dashTimer = 0;

// Hard Mode Variables
let difficultyLevel = 1;
let difficultyTimer = 0;
let startTime = Date.now();

let baseSpeed = 350;
let manualBoost = 175;

// Arrays containing asset keys for random generation
let spikeTypes = ['spike1', 'spike2', 'spike3', 'spike4', 'spike6', 'spike7', 'spike8', 'spike9', 'enemy'];
let brickTypes = ['brick1', 'brick2', 'brick3', 'brick4', 'brick5', 'brick6', 'brick7', 'brick8'];
let itemTypes = ['jetpack', 'gun', 'health'];

/**
 * PRELOAD: Load images into memory before game starts.
 */
function preload() {
    this.load.image('box', 'assets/1box.png');
    this.load.image('ground', 'assets/ground.png');
    this.load.image('bg', 'assets/bg1.png');
    this.load.image('jetpack', 'assets/jetpack.png');
    this.load.image('gun', 'assets/gun.png');
    this.load.image('health', 'assets/health.png');
    this.load.image('bullet', 'assets/bullet.png');
    this.load.image('enemy', 'assets/enemy.png');
    this.load.image('gear', 'assets/gear.png');
    this.load.image('plasma', 'assets/plasma.png');
    this.load.audio('levelTheme', 'assets/bg.aac');


    // Load dynamic variations
    spikeTypes.forEach(s => this.load.image(s, `assets/${s}.png`));
    brickTypes.forEach(b => this.load.image(b, `assets/${b}.png`));

    // Verse: inside preload()
    this.load.image('ghost', 'assets/enemy2.png');
}

/**
 * CREATE: Initialize objects, networking, and input listeners.
 */
function create() {
    this.socket = io();

    // Initialize the music
    this.music = this.sound.add('levelTheme', {
        volume: 0.4,
        loop: true
    });

    //Start playing
    this.music.play();

    // 1. MULTIPLAYER GROUPS (Other players and their bullets)
    this.otherPlayers = this.physics.add.group();
    this.networkBullets = this.physics.add.group({
        defaultKey: 'bullet',
        maxSize: 30
    });

    // 2. BACKGROUND & WORLD (Parallax setup)
    this.bg = this.add.tileSprite(640, 360, 1280, 720, 'bg').setScrollFactor(0);
    this.bg.setTint(0xbbbbbb); //light grey that dims it slightly

    // Ground
    ground = this.add.tileSprite(640, 700, 1280, 32, 'ground');
    this.physics.add.existing(ground, true);

    // 3. PLAYER SETUP
    player = this.physics.add.image(100, 450, 'box');
    player.setDepth(10); // Ensure player is always on top
    this.physics.add.collider(player, ground);

    // Neon Trail Effect
    const particles = this.add.particles(0, 0, 'box', {
        speed: 10,
        scale: { start: 0.04, end: 0 },
        alpha: { start: 0.5, end: 0 },
        lifespan: 200,
        blendMode: 'ADD',
        follow: player
    });

    // 4. CAMERA SETUP (Follows player with an offset)
    this.cameras.main.startFollow(player, true, 0.1, 0.1);
    this.cameras.main.setFollowOffset(-250, 150);

    // 5. INPUT REGISTRATION
    cursors = this.input.keyboard.createCursorKeys();
    spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    zerokey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ZERO);;

    // 6. OBJECT GROUPS
    spikes = this.physics.add.group();
    bricks = this.physics.add.group();
    items = this.physics.add.group();
    enemy = this.physics.add.group();
    bulletGroup = this.physics.add.group();
    geargroup = this.physics.add.group();


    // 7. SOCKET LISTENERS (Handling Server Events)
    this.socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (players[id].playerId === this.socket.id) {
                health = players[id].health || 100;
            } else {
                addOtherPlayer.call(this, players[id]);
            }
        });
    });

    this.socket.on('newPlayer', (playerInfo) => addOtherPlayer.call(this, playerInfo));

    this.socket.on('playerDisconnected', (playerId) => {
        this.otherPlayers.getChildren().forEach(op => {
            if (playerId === op.playerId) op.destroy();
        });
    });

    this.socket.on('playerMoved', (p) => {
        this.otherPlayers.getChildren().forEach(op => {
            if (p.playerId === op.playerId) op.setPosition(p.x, p.y);
        });
    });

    this.socket.on('bulletFired', (data) => {
        const b = this.networkBullets.create(data.x, data.y, 'bullet');
        if (b) {
            b.body.allowGravity = false;
            b.setVelocity(data.velocityX, data.velocityY || 0);
            b.setTint(0xffaa00); // Plasma Fire Orange
            b.ownerId = data.ownerId;


            // Heavy Boost Trail
            const trail = this.add.particles(0, 0, 'bullet', {
                speed: 100, scale: { start: 0.4, end: 0 },
                alpha: { start: 0.6, end: 0 }, lifespan: 300,
                blendMode: 'ADD', tint: 0xffaa00,
                follow: b
            });

            this.time.delayedCall(2000, () => {
                if (b.active) b.destroy();
                trail.destroy();
            });
        }
    });

    this.socket.on('playerWasHit', (info) => {
        if (info.playerId === this.socket.id) {
            health = info.health; // Sync health with server source of truth
            player.setTint(0xff0000);
            this.cameras.main.shake(100, 0.02);
            this.time.delayedCall(200, () => player.clearTint());
            if (health <= 0) {
                this.physics.pause();
                showGameOverModal(score);
            }
        }
    });

    // 8. COLLISIONS & OVERLAPS
    this.physics.add.collider(player, spikes, hitspike, null, this);
    this.physics.add.collider(player, geargroup, hitspike, null, this);
    this.physics.add.collider(player, spawnghost, hitspike, null, this);
    this.physics.add.collider(player, enemy, hitspike, null, this);
    this.physics.add.collider(player, bricks);
    this.physics.add.overlap(player, items, collectItem, null, this);
    this.physics.add.collider(player, geargroup);

    // Environmental collisions
    this.physics.add.collider(enemy, ground);
    this.physics.add.collider(enemy, bricks);
    this.physics.add.collider(items, ground); // Fix: items hit the ground
    this.physics.add.collider(this.otherPlayers, ground);

    // PvP Hit Detection (When a network bullet hits YOU)
    this.physics.add.overlap(player, this.networkBullets, (p, b) => {
        if (b.ownerId !== this.socket.id) {
            this.socket.emit('playerHit', { playerId: this.socket.id });
            b.destroy();
        }
    }, null, this);

    // Bullet vs Enemy/Spikes
    this.physics.add.collider(bulletGroup, enemy, (bullet, enmy) => {
        this.cameras.main.shake(100, 0.01);
        explode.call(this, enmy.x, enmy.y);
        bullet.destroy();
        enmy.destroy();
    });
    
    this.physics.add.collider(bulletGroup, spikes, (bullet, s) => {
        explode.call(this, s.x, s.y);
        bullet.destroy();
        s.destroy();
    });

    // Bullet vs Gears
this.physics.add.collider(bulletGroup, geargroup, (bullet, gear) => {
    explode.call(this, gear.x, gear.y); // Trigger the explosion effect
    bullet.destroy();                   // Remove the bullet
    gear.destroy();                     // Remove the gear
});

    // 9. UI & PARTICLES
    // Phaser Text UI Removed in favor of DOM UI

    // Thruster/Trail effect
    this.emitter = this.add.particles(0, 0, 'bullet', {
        speed: 100, scale: { start: 0.4, end: 0 },
        alpha: { start: 0.5, end: 0 }, lifespan: 500,
        blendMode: 'ADD', follow: player
    });

    // Initial Spawning
    spawnRandomSpike.call(this);
    spawnRandomBrick.call(this);
    spawnRandomgear.call(this);


    ghosts = this.physics.add.group();

    // If ghosts hurt the player like spikes:
    this.physics.add.overlap(player, ghosts, hitspike, null, this);

    // Start the spawning loop
    spawnRandomGhost.call(this);

 

// 2. Add the Global Pointer Listener

// --- IMPROVED MULTI-TOUCH MOBILE CONTROLS ---
// --- MOBILE CONTROLS (ENHANCED) ---

// --- MOBILE CONTROLS (ENHANCED) ---

    // 1. Declare variables at the top of this section
    let shootBtn, dashBtn, blastBtn;

    // 2. Only create these if NOT on desktop
    if (!this.sys.game.device.os.desktop) {

        // JOYSTICK SETUP
        const joystickBase = this.add.circle(150, 570, 60, 0xffffff, 0.2).setScrollFactor(0).setDepth(100);
        const joystickThumb = this.add.circle(150, 570, 30, 0xffffff, 0.4).setScrollFactor(0).setDepth(101);

        this.joystickData = { dragging: false, forceX: 0, forceY: 0 };

        this.input.on('pointerdown', (pointer) => {
            if (pointer.x < 400) {
                this.joystickData.dragging = true;
                joystickBase.setPosition(pointer.x, pointer.y);
                joystickThumb.setPosition(pointer.x, pointer.y);
            }
        });

        this.input.on('pointermove', (pointer) => {
            if (this.joystickData.dragging) {
                const dist = Phaser.Math.Distance.Between(joystickBase.x, joystickBase.y, pointer.x, pointer.y);
                const angle = Phaser.Math.Angle.Between(joystickBase.x, joystickBase.y, pointer.x, pointer.y);
                const maxDist = 60;
                const clampedDist = Math.min(dist, maxDist);
                joystickThumb.x = joystickBase.x + Math.cos(angle) * clampedDist;
                joystickThumb.y = joystickBase.y + Math.sin(angle) * clampedDist;
                this.joystickData.forceX = (joystickThumb.x - joystickBase.x) / maxDist;
                this.joystickData.forceY = (joystickThumb.y - joystickBase.y) / maxDist;
            }
        });

        this.input.on('pointerup', () => {
            this.joystickData.dragging = false;
            this.joystickData.forceX = 0;
            this.joystickData.forceY = 0;
            joystickBase.setPosition(150, 570);
            joystickThumb.setPosition(150, 570);
        });

        // 3. ACTION BUTTONS (Assigning to our top-level variables)
        shootBtn = this.add.circle(1160, 600, 40, 0xff0000, 0.3).setScrollFactor(0).setInteractive().setDepth(100);
        this.add.text(1160, 600, '🔥', { fontSize: '32px' }).setOrigin(0.5).setScrollFactor(0).setDepth(101);
        shootBtn.on('pointerdown', () => { if (bullets > 0) fireBullet.call(this); });

        dashBtn = this.add.circle(1160, 460, 30, 0x00f3ff, 0.3).setScrollFactor(0).setInteractive().setDepth(100);
        this.add.text(1160, 460, '💨', { fontSize: '24px' }).setOrigin(0.5).setScrollFactor(0).setDepth(101);
        dashBtn.on('pointerdown', () => { this.isMobileDashing = true; });

        blastBtn = this.add.circle(1020, 600, 30, 0xffea00, 0.3).setScrollFactor(0).setInteractive().setDepth(100);
        this.add.text(1020, 600, '💥', { fontSize: '24px' }).setOrigin(0.5).setScrollFactor(0).setDepth(101);
        blastBtn.on('pointerdown', () => { this.isMobileBlasting = true; });

        // 4. Update the group for the jump logic
        this.mobileButtons = [shootBtn, dashBtn, blastBtn];

        // Multi-touch for Jump
        this.input.addPointer(2); 
        this.input.on('pointerdown', (pointer) => {
            const distToJoystick = Phaser.Math.Distance.Between(pointer.x, pointer.y, joystickBase.x, joystickBase.y);
            // Safety check: ensure buttons exist before checking distance
            const overButton = this.mobileButtons.some(btn => btn && Phaser.Math.Distance.Between(pointer.x, pointer.y, btn.x, btn.y) < 60);

            if (distToJoystick > 100 && !overButton) {
                if (player.body.touching.down || player.body.blocked.down) {
                    player.setVelocityY(-550);
                    player.setAngularVelocity(300);
                } else {
                    this.isMobileJumping = true; 
                }
            }
        });

        this.input.on('pointerup', () => { this.isMobileJumping = false; });
    } else {
        // Desktop safety: ensure the array exists so the game doesn't crash on click
        this.mobileButtons = [];
    }
}
/**
 * UPDATE: Game loop running every frame.
 */
function update() {
    if (this.physics.world.isPaused || !player) return;

    // --- BACKGROUND SCROLLING ---
    this.bg.tilePositionX = this.cameras.main.scrollX * 0.3;
    ground.x = this.cameras.main.scrollX + 640;
    ground.body.x = this.cameras.main.scrollX;
    ground.tilePositionX = this.cameras.main.scrollX;

    // --- MOVEMENT: JETPACK & JUMP LOGIC (Keyboard + Mobile Joystick) ---
    // Check if moving up: Up Arrow OR Joystick pushed significantly up
    let isMovingUp = cursors.up.isDown || (this.joystickData && this.joystickData.forceY < -0.3);

    if (isMovingUp && flytime > 0) {
        player.setVelocityY(-300);
        flytime -= 1;
        player.setAngle(-15);
        this.cameras.main.zoomTo(0.7, 1000);
    } else {
        this.cameras.main.zoomTo(1, 1000);
        player.setAngle(0);
    }

// --- MOVEMENT: GROUND JUMP (Fixed for High Speed) ---
// We check for: Spacebar OR the Mobile Tap Flag OR Joystick pushed hard Up
let wantsToJump = Phaser.Input.Keyboard.JustDown(spaceKey) || this.isMobileJumping;

// Add Joystick 'Up' to the jump trigger if touching ground
if (this.joystickData && this.joystickData.forceY < -0.7) {
    wantsToJump = true;
}

if (wantsToJump && (player.body.touching.down || player.body.blocked.down)) {
    player.setVelocityY(-550); // Increased slightly for better feel at high speeds
    player.setAngularVelocity(300);
    
    // IMPORTANT: Reset the flag so we don't 'double jump' accidentally
    this.isMobileJumping = false; 
}

// Safety: If we aren't touching the ground, clear the jump flag 
// so it doesn't 'wait' until we land to jump.
if (!player.body.touching.down && !player.body.blocked.down) {
    this.isMobileJumping = false;
}

    // --- DIFFICULTY SCALING ---
    difficultyTimer++;
    if (difficultyTimer > 1000) {
        difficultyTimer = 0;
        difficultyLevel++;
        baseSpeed += 15;
        
        showToast(`DANGER LEVEL ${difficultyLevel}! SPEED UP!`);
    }

    // --- DASH LOGIC (Keyboard + Mobile Button) ---
    let wantsToDash = Phaser.Input.Keyboard.JustDown(shiftKey) || this.isMobileDashing;

    if (isDashing) {
        dashTimer--;
        if (dashTimer <= 0) {
            isDashing = false;
            player.setVelocityX(baseSpeed);
        }
    } else {
        if (wantsToDash && flytime >= 100) {
            this.isMobileDashing = false; // Reset mobile flag
            isDashing = true;
            dashTimer = 20; 
            player.setVelocityX(baseSpeed + 1500);
            flytime -= 100;

            this.cameras.main.shake(200, 0.02);
            const dashParticles = this.add.particles(player.x, player.y, 'box', {
                speed: 100, scale: { start: 0.1, end: 0 },
                lifespan: 500, blendMode: 'ADD', tint: 0x00f3ff,
                quantity: 20
            });
            this.time.delayedCall(500, () => dashParticles.destroy());
        } else {
            // Horizontal speed: Right Arrow OR Joystick pushed right
            let isMovingRight = cursors.right.isDown || (this.joystickData && this.joystickData.forceX > 0.3);
            player.setVelocityX(isMovingRight ? baseSpeed + manualBoost : baseSpeed);
        }
    }

    // --- BLAST LOGIC (Keyboard + Mobile Button) ---
    let wantsToBlast = Phaser.Input.Keyboard.JustDown(zerokey) || this.isMobileBlasting;

    if (isblast) {
        blastTimer--;
        player.setVelocityX(baseSpeed + 2500);
        if (blastTimer <= 0) {
            isblast = false;
            this.time.timeScale = 1;
        }
    }

    if (wantsToBlast && bullets >= 10 && !isblast) {
        this.isMobileBlasting = false; // Reset mobile flag
        isblast = true;
        blastTimer = 40;
        bullets -= 10;

        this.time.timeScale = 0.2;
        this.cameras.main.shake(500, 0.03);
        this.cameras.main.flash(200, 255, 255, 255);

        const wave = this.add.circle(player.x, player.y, 10, 0xffffff, 0.5);
        this.tweens.add({
            targets: wave,
            radius: 600,
            alpha: 0,
            duration: 400,
            onComplete: () => wave.destroy()
        });

        const groupsToClear = [spikes, bricks, enemy, ghosts, geargroup];
        groupsToClear.forEach(group => {
            if (group) {
                group.getChildren().forEach((child) => {
                    this.time.delayedCall(Math.random() * 200, () => {
                        if (child.active) child.destroy();
                    });
                });
            }
        });

        const dashWave = this.add.particles(-200, -10, 'plasma', {
            speedX: { min: 600, max: 800 },
            scale: { start: 0.5, end: 0 },
            alpha: { start: 1, end: 0 },
            lifespan: 800,
            follow: player
        });
        this.time.delayedCall(1000, () => dashWave.destroy());
    }

    // --- COMBAT: SHOOTING ---
    if (Phaser.Input.Keyboard.JustDown(enterKey) && bullets > 0) {
        fireBullet.call(this);
    }

    // --- NETWORKING ---
    if (player.oldPosition && (player.x !== player.oldPosition.x || player.y !== player.oldPosition.y)) {
        this.socket.emit('playerMovement', { x: player.x, y: player.y });
    }
    player.oldPosition = { x: player.x, y: player.y };

   // --- ENEMY AI ---
enemy.getChildren().forEach(badGuy => {
    if (badGuy.isJumper && badGuy.body.touching.down && Phaser.Math.Between(0, 100) > 98) {
        badGuy.setVelocityY(-350);
    }

    let distance = Phaser.Math.Distance.Between(player.x, player.y, badGuy.x, badGuy.y);

    if (distance < 500) {
        // ENEMY IS WITHIN RANGE: MOVE TOWARDS PLAYER
        if (badGuy.x > player.x) {
            badGuy.setVelocityX(-150); // Player is to the left, move left
        } else {
            badGuy.setVelocityX(150);  // Player is to the right, move right
        }
        badGuy.setTint(0xff0000); // Red for "Aggro"
    } else {
        // ENEMY IS FAR AWAY: SLOW DOWN OR PATROL
        badGuy.setVelocityX(0); 
        badGuy.clearTint();
    }
});

    cleanupObjects.call(this);

    // --- UI REFRESH (DOM) ---
    score = Math.floor(player.x / 100);
    document.getElementById('score-val').innerText = score.toString().padStart(4, '0');
    document.getElementById('ammo-val').innerText = bullets;
    document.getElementById('hp-bar').style.width = Math.max(0, health) + '%';
    document.getElementById('fuel-bar').style.width = Math.max(0, (flytime / 1000) * 100) + '%';

    if (comboTimer > 0) {
        comboTimer--;
    } else {
        comboCount = 0;
        document.getElementById('combo-container').style.display = 'none';
    }

    document.getElementById('difficulty-display').innerText = 'DANGER LEVEL: ' + difficultyLevel;

    // --- GHOST MOVEMENT ---
    ghosts.getChildren().forEach(ghost => {
        ghost.y = ghost.startY + Math.sin(this.time.now / 200 * ghost.wobbleSpeed) * 50;
    });
}
// --- HELPERS ---

/**
 * Creates a particle explosion effect.
 */
function explode(x, y) {
    const ex = this.add.particles(x, y, 'bullet', {
        speed: { min: -200, max: 200 }, angle: { min: 0, max: 360 },
        scale: { start: 0.5, end: 0 }, lifespan: 400,
        gravityY: 800, quantity: 10, emitting: false
    });
    ex.explode();

    // Combo Logic: Killing enemies resets timer and increments count
    comboCount++;
    comboTimer = 150; // Frames (approx 2.5 seconds)

    // Update Combo UI
    const comboContainer = document.getElementById('combo-container');
    const comboVal = document.getElementById('combo-val');
    comboContainer.style.display = 'block';
    comboVal.innerText = 'x' + comboCount;
    comboVal.style.color = comboCount > 5 ? '#ffea00' : '#ff0055'; // Gold if high combo
}

/**
 * Instantiates a bullet and notifies the server.
 */
/**
 * Instantiates a TRIPLE SHOT and notifies the server.
 */
function fireBullet() {
    bullets--;

    // Spread Angles
    const angles = [0, -150, 150];

    angles.forEach(vy => {
        const b = bulletGroup.create(player.x + 20, player.y, 'bullet');
        b.body.allowGravity = false;
        b.setVelocity(1500, vy);
        b.setTint(0xffaa00); // Plasma Fire Orange

        // Heavy Boost Trail
        const trail = this.add.particles(0, 0, 'bullet', {
            speed: 100, scale: { start: 0.4, end: 0 },
            alpha: { start: 0.6, end: 0 }, lifespan: 300,
            blendMode: 'ADD', tint: 0xffaa00,
            follow: b
        });

        this.time.delayedCall(2000, () => {
            if (b.active) b.destroy();
            trail.destroy();
        });

        this.socket.emit('playerShoots', {
            x: b.x, y: b.y, velocityX: 1500, velocityY: vy, ownerId: this.socket.id
        });
    });
}

/**
 * Handles hazard collision and alerts the server.
 */
function hitspike(player, spike) {
    // 1. If we are already in the "mercy period," ignore the hit
    if (isInvincible) return;

    // 2. Start invincibility
    isInvincible = true;
    
    // 3. Shake and Tint
    this.cameras.main.shake(200, 0.02);
    player.setTint(0xff0000);

    // 4. Send damage to server (Lowered to 10 for better balance)
    this.socket.emit('playerHit', { playerId: this.socket.id, damage: 5 });

    // 5. Create a "flicker" effect to show you are safe
    this.tweens.add({
        targets: player,
        alpha: 0.3,
        duration: 100,
        yoyo: true,
        repeat: 5, // Lasts about 1 second total
        onComplete: () => {
            isInvincible = false;
            player.setAlpha(1);
            player.clearTint();
        }
    });

    // Destroy the object so you don't hit it again
    if (spike && spike.active) spike.destroy();
}
/**
 * Spawns a brick with potential items/enemies on top.
 */
function spawnBrick() {
    let key = Phaser.Math.RND.pick(brickTypes);
    let spawnX = this.cameras.main.scrollX + 1500;
    let spawnY = Phaser.Math.Between(140, 360);
    let brick = bricks.create(spawnX, spawnY, key);
    brick.setImmovable(true).body.allowGravity = false;

    let chance = Phaser.Math.Between(0, 100);

    // Only spawn enemies/items 40% of the time (if chance is 80-100)
    if (chance > 60) { 
        let type = Phaser.Math.RND.pick(itemTypes);
        
        // Decide if this enemy/item pair is floating or has gravity
        let isFloating = Phaser.Math.Between(0, 1) === 0;

        if (isFloating) {
            // Option A: Floating setup
            enemy.create(spawnX, spawnY - 20, 'enemy');
            let item = items.create(spawnX, spawnY - 65, type);
            item.body.allowGravity = false;
            item.type = type;
        } else {
            // Option B: Physics/Gravity setup
            let badGuy = enemy.create(spawnX, spawnY - 45, 'enemy');
            badGuy.body.allowGravity = true;
            badGuy.setBounce(0.2);

            let item = items.create(spawnX, spawnY - 65, type);
            item.body.allowGravity = true;
            item.setBounce(0.3);
            item.type = type;
        }
    }
}

/**
 * Adds a visual representation of another player connected to the server.
 */
function addOtherPlayer(playerInfo) {
    const op = this.physics.add.image(playerInfo.x, playerInfo.y, 'box');
    op.setTint(0x0000ff);
    op.playerId = playerInfo.playerId;
    this.otherPlayers.add(op);
}

/**
 * Item collection logic.
 */
function collectItem(player, item) {
    if (item.type === 'jetpack') flytime = Math.min(flytime + 250, 1500);
    else if (item.type === 'gun') bullets = Math.min(bullets + 10, 30);
    else if (item.type === 'health') health = Math.min(health + 25, 150);
    item.destroy();
}

// Infinite recursive spawning loops
function spawnRandomSpike() {
    if (this.physics.world.isPaused) return;

    // Spawn 1000 pixels ahead of the camera so it doesn't pop in visibly
    let spawnX = this.cameras.main.scrollX + 1500;
    // Calculate the top of the ground (Ground Y - half its height)
    // If ground is at 700 and 32px tall, top is 684
    let groundTop = ground.y - (ground.displayHeight / 2);
    let spike = spikes.create(spawnX, groundTop, Phaser.Math.RND.pick(spikeTypes));
    // IMPORTANT: Set origin to the bottom (1) so it sits ON the groundTop
    spike.setOrigin(0.5, 0.8);
    // Physics setup
    spike.setImmovable(true);
    spike.body.allowGravity = false;
    // Refresh the physics body to match the new origin/position
    spike.body.updateFromGameObject();
    // Difficulty scaling
    let delay = Phaser.Math.Between(1500, 4000) - (difficultyLevel * 100);
    delay = Math.max(500, delay);
    this.time.delayedCall(delay, spawnRandomSpike, [], this);
}

function spawnRandomBrick() {
    if (this.physics.world.isPaused) return;
    spawnBrick.call(this);
    let delay = Phaser.Math.Between(1000, 2000) - (difficultyLevel * 100);
    delay = Math.max(500, delay);
    this.time.delayedCall(delay, spawnRandomBrick, [], this);
}

/**
 * Memory Management: Removes objects that have scrolled off-screen.
 */
function cleanupObjects() {
    [spikes, bricks, items, enemy, bulletGroup, geargroup, this.networkBullets].forEach(group => {
        if (!group) return;
        group.getChildren().forEach(child => {
            if (child.x < this.cameras.main.scrollX - 150) child.destroy();
        });
    });
}

// --- UI HELPERS ---

function showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>🔔</span> <span>${message}</span>`;
    container.appendChild(toast);

    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s reverse forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showGameOverModal(finalScore) {
    const overlay = document.getElementById('modal-overlay');
    const nameInput = document.getElementById('player-name');
    const submitBtn = document.getElementById('submit-score-btn');

    overlay.style.display = 'flex';
    nameInput.focus();

    submitBtn.onclick = () => {
        const name = nameInput.value || 'Player';
        submitBtn.disabled = true;
        submitBtn.innerHTML = 'Submitting...';

        fetch('/api/submit-score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, score: finalScore })
        }).then(() => {
            window.location.href = '/';
        }).catch(err => {
            console.error(err);
            showToast('Submission failed! Redirecting...');
            setTimeout(() => window.location.href = '/', 2000);
        });
    };
}

// Verse: bottom of script
function spawngear() {
    // 1. Check if the group exists to prevent crashes
    if (!geargroup) return;

    let spawnX = this.cameras.main.scrollX + 1500;
    let spawnY = Phaser.Math.Between(70, 500);

    // 2. FIXED: Use 'geargroup', and name the individual sprite 'newGear'
    let newGear = geargroup.create(spawnX, spawnY, 'gear');

    if (newGear) {
        newGear.setImmovable(true);
        newGear.body.allowGravity = false;
        // Optional: Make it spin so it looks like a gear
        newGear.setAngularVelocity(100);
    }

    // 🔽 REDUCE HITBOX (padding)
    newGear.body.setSize(
        newGear.width * 0.6,
        newGear.height * 0.6
    );

    // 🔽 CENTER THE SMALLER HITBOX
    newGear.body.setOffset(
        newGear.width * 0.2,
        newGear.height * 0.2
    );
}

function spawnRandomgear() {
    if (this.physics.world.isPaused) return;

    // 3. FIXED: Call the correct function name
    spawngear.call(this);

    let delay = Phaser.Math.Between(5000, 9000) - (difficultyLevel * 100);
    delay = Math.max(2000, delay); // Don't let it spawn too fast

    this.time.delayedCall(delay, spawnRandomgear, [], this);
}

// Verse: bottom of script
function spawnghost() {
    if (!ghosts) return;

    let spawnX = this.cameras.main.scrollX + 1500;
    // Ghosts can spawn anywhere since they fly!
    let spawnY = Phaser.Math.Between(45, 380);

    let ghost = ghosts.create(spawnX, spawnY, 'ghost');

    if (ghost) {
        ghost.body.allowGravity = false;
        ghost.setTint(0x88ffff); // Give them a ghostly blue/transparent glow
        ghost.setAlpha(0.7);

        // Give the ghost a unique property for its movement
        ghost.startY = spawnY;
        ghost.wobbleSpeed = Phaser.Math.Between(1, 2);

        // Move left toward the player
        ghost.setVelocityX(Phaser.Math.Between(-100, -200));
    }
}

function spawnRandomGhost() {
    if (this.physics.world.isPaused || !player) return;

    spawnghost.call(this);

    let delay = Phaser.Math.Between(5000, 8000) - (difficultyLevel * 100);
    this.time.delayedCall(Math.max(2000, delay), spawnRandomGhost, [], this);
}

