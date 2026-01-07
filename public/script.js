/** * GAME CONFIGURATION
 * Configures the Phaser engine, physics, and main scene hooks.
 */
const config = {
    type: Phaser.AUTO,

    scale: {
        mode: Phaser.Scale.FIT, // Stretches to fit
        autoCenter: Phaser.Scale.CENTER_BOTH, // Centers game on screen
        width: 800,
        height: 600
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
let health = 100;
let flytime = 1000;

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
let manualBoost = 150;

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

    // 1. MULTIPLAYER GROUPS (Other players and their bullets)
    this.otherPlayers = this.physics.add.group();
    this.networkBullets = this.physics.add.group({
        defaultKey: 'bullet',
        maxSize: 30
    });

    // 2. BACKGROUND & WORLD (Parallax setup)
    this.bg = this.add.tileSprite(400, 300, 800, 600, 'bg').setScrollFactor(0);
    this.bg.setTint(0xbbbbbb); //light grey that dims it slightly

    // Ground
    ground = this.add.tileSprite(400, 580, 800, 32, 'ground');
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

    // --- MOBILE CONTROLS ---

    // Left half of screen = Fly/Jump
    this.jumpZone = this.add.zone(0, 0, 400, 600).setOrigin(0).setInteractive().setScrollFactor(0);

    // Right half of screen = Shoot
    this.shootZone = this.add.zone(400, 0, 400, 600).setOrigin(0).setInteractive().setScrollFactor(0);

    // Logic for Jump/Fly
    this.jumpZone.on('pointerdown', () => { this.isMobileJumping = true; });
    this.jumpZone.on('pointerup', () => { this.isMobileJumping = false; });

    // Logic for Shooting
    this.shootZone.on('pointerdown', () => {
        if (bullets > 0) fireBullet.call(this);
    });

    // Update the Flying Logic
    if ((cursors.up.isDown || this.isMobileJumping) && flytime > 0) {
        player.setVelocityY(-300);
        flytime -= 1.8;
        player.setAngle(-15);
        this.cameras.main.zoomTo(0.7, 1000);
    } else {
        this.cameras.main.zoomTo(1, 1000);
        player.setAngle(0);
    }

    // Update the Jumping Logic
    if ((Phaser.Input.Keyboard.JustDown(spaceKey) || (this.isMobileJumping && player.body.touching.down)) && player.body.touching.down) {
        player.setVelocityY(-500);
        player.setAngularVelocity(300);
    }

    // Verse: inside create()
    ghosts = this.physics.add.group();

    // If ghosts hurt the player like spikes:
    this.physics.add.overlap(player, ghosts, hitspike, null, this);

    // Start the spawning loop
    spawnRandomGhost.call(this);

}

/**
 * UPDATE: Game loop running every frame.
 */
function update() {
    if (this.physics.world.isPaused || !player) return;

    // Background scrolling
    this.bg.tilePositionX = this.cameras.main.scrollX * 0.3;
    ground.x = this.cameras.main.scrollX + 400;
    ground.body.x = this.cameras.main.scrollX;
    ground.tilePositionX = this.cameras.main.scrollX;

    // Movement: Jetpack Logic
    if (cursors.up.isDown && flytime > 0) {
        player.setVelocityY(-300);
        flytime -= 1.8;
        player.setAngle(-15);
        this.cameras.main.zoomTo(0.7, 1000);
    } else {
        this.cameras.main.zoomTo(1, 1000);
        player.setAngle(0);
    }

    // Movement: Ground Jump
    if (Phaser.Input.Keyboard.JustDown(spaceKey) && player.body.touching.down) {
        player.setVelocityY(-500);
        player.setAngularVelocity(300);
    }

    // Difficulty Scaling (Every ~10 seconds @ 60fps)
    difficultyTimer++;
    if (difficultyTimer > 600) {
        difficultyTimer = 0;
        difficultyLevel++;
        baseSpeed += 30; // Ramps up speed significantly

        // Visual indicator
        showToast(`DANGER LEVEL ${difficultyLevel}! SPEED UP!`);

        // Cap fuel regen or increase consumption?
        // For now just speed is enough chaos
    }

    // Movement Logic
    if (isDashing) {
        // LOCK movement during dash
        dashTimer--;
        if (dashTimer <= 0) {
            isDashing = false;
            player.setVelocityX(baseSpeed); // Reset to normal speed
        }
    } else {
        // Normal Movement

        // Skill: Dash (Shift Key) - Costs 200 Fuel
        if (Phaser.Input.Keyboard.JustDown(shiftKey) && flytime >= 200) {
            isDashing = true;
            dashTimer = 20; // Dash lasts ~330ms (20 frames)
            player.setVelocityX(baseSpeed + 1500); // SUPER FAST
            flytime -= 200;

            // Dash Effects
            this.cameras.main.shake(200, 0.02);
            const dashParticles = this.add.particles(player.x, player.y, 'box', {
                speed: 100, scale: { start: 0.1, end: 0 },
                lifespan: 500, blendMode: 'ADD', tint: 0x00f3ff,
                quantity: 20
            });
            this.time.delayedCall(500, () => dashParticles.destroy());
        } else {
            player.setVelocityX(cursors.right.isDown ? baseSpeed + manualBoost : baseSpeed);
        }
    }

    //isblast
    // 1. Handle Blast Timer Countdown (Updated for Slow Motion)
    if (isblast) {
        blastTimer--;
        // Maintain high velocity even during slow-mo to feel powerful
        player.setVelocityX(baseSpeed + 2500);

        if (blastTimer <= 0) {
            isblast = false;
            this.time.timeScale = 1; // Restore normal game speed
        }
    }

    // 2. Trigger the Blast (Wave -> Slow Motion -> Destroy)
    if (Phaser.Input.Keyboard.JustDown(zerokey) && bullets >= 10) {
        isblast = true;
        blastTimer = 40; // Increased timer because slow-mo lasts longer
        bullets -= 10;

        // --- SLOW MOTION ---
        this.time.timeScale = 0.2; // Game moves at 20% speed
        this.cameras.main.shake(500, 0.03);
        this.cameras.main.flash(200, 255, 255, 255); // White flash for impact

        // --- THE WAVE VISUAL ---
        const wave = this.add.circle(player.x, player.y, 10, 0xffffff, 0.5);
        this.tweens.add({
            targets: wave,
            radius: 600, // Grows to cover screen
            alpha: 0,
            duration: 400,
            onComplete: () => wave.destroy()
        });

        // --- DELAYED DESTRUCTION (The "Shatter" feel) ---
        // We wait a few milliseconds in "real time" so the player sees the wave hit
        const groupsToClear = [spikes, bricks, enemy, ghosts, geargroup];

        groupsToClear.forEach(group => {
            if (group) {
                group.getChildren().forEach((child) => {
                    // Add a small individual delay for a "chain reaction" effect
                    this.time.delayedCall(Math.random() * 200, () => {
                        if (child.active) {
                            // Optional: Add a tiny explosion per enemy
                            // this.add.particles(child.x, child.y, 'box', {...});
                            child.destroy();
                        }
                    });
                });
            }
        });

        // Particle Wave Trail
        const dashWave = this.add.particles(-200, -10, 'box', {
            speedX: { min: 600, max: 800 },
            scale: { start: 0.5, end: 0 },
            alpha: { start: 1, end: 0 },
            lifespan: 800,
            follow: player
        });
        
        this.time.delayedCall(1000, () => dashWave.destroy());
    }

    // Combat: Shooting
    if (Phaser.Input.Keyboard.JustDown(enterKey) && bullets > 0) {
        fireBullet.call(this);
    }

    // Networking: Send position to server
    if (player.oldPosition && (player.x !== player.oldPosition.x || player.y !== player.oldPosition.y)) {
        this.socket.emit('playerMovement', { x: player.x, y: player.y });
    }
    player.oldPosition = { x: player.x, y: player.y };

    // Enemy AI: Simple agro and jumping
    enemy.getChildren().forEach(badGuy => {
        if (badGuy.isJumper && badGuy.body.touching.down && Phaser.Math.Between(0, 100) > 98) {
            badGuy.setVelocityY(-400);
        }
        let distance = Phaser.Math.Distance.Between(player.x, player.y, badGuy.x, badGuy.y);
        if (distance < 450) {
            badGuy.setVelocityX(-100);
            badGuy.setTint(0xff0000);
        }
        else if (distance > 400) {
            badGuy.setVelocityX(100);
            badGuy.setTint(0xff0000);
        }
    });

    cleanupObjects.call(this);

    // Refresh HUD (DOM)
    score = Math.floor(player.x / 100);

    // Update DOM elements
    document.getElementById('score-val').innerText = score.toString().padStart(4, '0');
    document.getElementById('ammo-val').innerText = bullets;

    const hpPercent = Math.max(0, health);
    document.getElementById('hp-bar').style.width = hpPercent + '%';

    const fuelPercent = Math.max(0, (flytime / 1000) * 100);
    document.getElementById('fuel-bar').style.width = fuelPercent + '%';

    // Combo Timer Decay
    if (comboTimer > 0) {
        comboTimer--;
    } else {
        comboCount = 0;
        document.getElementById('combo-container').style.display = 'none';
    }

    // Update Difficulty UI
    document.getElementById('difficulty-display').innerText = 'DANGER LEVEL: ' + difficultyLevel;

    // Verse: inside update()
    ghosts.getChildren().forEach(ghost => {
        // Math.sin creates a smooth up-and-down wave
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
        b.setVelocity(900, vy);
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
            x: b.x, y: b.y, velocityX: 900, velocityY: vy, ownerId: this.socket.id
        });
    });
}

/**
 * Handles hazard collision and alerts the server.
 */
function hitspike(player, spike) {
    spike.destroy();
    // health -= 10; // REMOVED: Server will emit 'playerWasHit' to sync this
    player.setTint(0xff0000);
    this.cameras.main.shake(200, 0.05);
    this.time.delayedCall(200, () => player.clearTint());
    this.socket.emit('playerHit', { playerId: this.socket.id, damage: 10 });
}

/**
 * Spawns a brick with potential items/enemies on top.
 */
function spawnBrick() {
    let key = Phaser.Math.RND.pick(brickTypes);
    let spawnX = this.cameras.main.scrollX + 900;
    let spawnY = Phaser.Math.Between(150, 400);
    let brick = bricks.create(spawnX, spawnY, key);
    brick.setImmovable(true).body.allowGravity = false;

    let chance = Phaser.Math.Between(0, 100);

    if (chance > 70) {
        let type = Phaser.Math.RND.pick(itemTypes);
        enemy.create(spawnX, spawnY - 20, 'enemy');
        let item = items.create(spawnX, spawnY - 65, type);
        item.body.allowGravity = false;
        item.type = type;
    }
    else if (chance > 40) {
        let type = Phaser.Math.RND.pick(itemTypes);
        let badGuy = enemy.create(spawnX, spawnY - 45, 'enemy');
        badGuy.body.allowGravity = true;
        badGuy.setBounce(0.2);

        let item = items.create(spawnX, spawnY - 65, type);
        item.body.allowGravity = true;
        item.type = type;
        item.setBounce(0.3);
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
    if (item.type === 'jetpack') flytime = Math.min(flytime + 250, 1000);
    else if (item.type === 'gun') bullets = Math.min(bullets + 10, 30);
    else if (item.type === 'health') health = Math.min(health + 25, 100);
    item.destroy();
}

// Infinite recursive spawning loops
function spawnRandomSpike() {
    if (this.physics.world.isPaused) return;
    let spawnX = this.cameras.main.scrollX + 900;
    let spike = spikes.create(spawnX, 550, Phaser.Math.RND.pick(spikeTypes));
    spike.setImmovable(true).body.allowGravity = false;
    // Hard Mode: Spawn faster as difficulty increases
    let delay = Phaser.Math.Between(1500, 4000) - (difficultyLevel * 100);
    delay = Math.max(500, delay); // Cap at 500ms
    this.time.delayedCall(delay, spawnRandomSpike, [], this);
}

function spawnRandomBrick() {
    if (this.physics.world.isPaused) return;
    spawnBrick.call(this);
    let delay = Phaser.Math.Between(1000, 4000) - (difficultyLevel * 100);
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

    let spawnX = this.cameras.main.scrollX + 1000;
    let spawnY = Phaser.Math.Between(70, 480);

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

    let spawnX = this.cameras.main.scrollX + 1000;
    // Ghosts can spawn anywhere since they fly!
    let spawnY = Phaser.Math.Between(50, 500);

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

    let delay = Phaser.Math.Between(9000, 18000) - (difficultyLevel * 100);
    this.time.delayedCall(Math.max(5000, delay), spawnRandomGhost, [], this);
}

