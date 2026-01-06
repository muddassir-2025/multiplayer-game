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
let scoretext, flyText, bullettext, healthtext;

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
    this.load.image('bg', 'assets/bg.png');
    this.load.image('jetpack', 'assets/jetpack.png');
    this.load.image('gun', 'assets/gun.png');
    this.load.image('health', 'assets/health.png');
    this.load.image('bullet', 'assets/bullet.png');
    this.load.image('enemy', 'assets/enemy.png');

    // Load dynamic variations
    spikeTypes.forEach(s => this.load.image(s, `assets/${s}.png`));
    brickTypes.forEach(b => this.load.image(b, `assets/${b}.png`));
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
    ground = this.add.tileSprite(400, 580, 800, 32, 'ground');
    this.physics.add.existing(ground, true);

    // 3. PLAYER SETUP
    player = this.physics.add.image(100, 450, 'box');
    player.setDepth(10); // Ensure player is always on top
    this.physics.add.collider(player, ground);

    // 4. CAMERA SETUP (Follows player with an offset)
    this.cameras.main.startFollow(player, true, 0.1, 0.1);
    this.cameras.main.setFollowOffset(-250, 150);

    // 5. INPUT REGISTRATION
    cursors = this.input.keyboard.createCursorKeys();
    spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    // 6. OBJECT GROUPS
    spikes = this.physics.add.group();
    bricks = this.physics.add.group();
    items = this.physics.add.group();
    enemy = this.physics.add.group();
    bulletGroup = this.physics.add.group();

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
            b.setVelocityX(data.velocityX);
            b.ownerId = data.ownerId;
            this.time.delayedCall(2000, () => { if (b.active) b.destroy(); });
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
                window.alert("You have been eliminated!");
                window.location.reload();
            }
        }
    });

    // 8. COLLISIONS & OVERLAPS
    this.physics.add.collider(player, spikes, hitspike, null, this);
    this.physics.add.collider(player, enemy, hitspike, null, this);
    this.physics.add.collider(player, bricks);
    this.physics.add.overlap(player, items, collectItem, null, this);
    
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
    scoretext = this.add.text(40, 40, 'Score: 0', { fontSize: '32px', fill: '#000' }).setScrollFactor(0);
    flyText = this.add.text(40, 80, 'Fuel: 1000', { fontSize: '24px', fill: '#000' }).setScrollFactor(0);
    healthtext = this.add.text(580, 40, 'Health: 100', { fontSize: '24px', fill: '#000' }).setScrollFactor(0);
    bullettext = this.add.text(580, 80, 'Bullets: 10', { fontSize: '24px', fill: '#000' }).setScrollFactor(0);

    // Thruster/Trail effect
    this.emitter = this.add.particles(0, 0, 'bullet', {
        speed: 100, scale: { start: 0.4, end: 0 },
        alpha: { start: 0.5, end: 0 }, lifespan: 500,
        blendMode: 'ADD', follow: player
    });

    // Initial Spawning
    spawnRandomSpike.call(this);
    spawnRandomBrick.call(this);

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
    flytime -= 2;
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
        flytime -= 2;
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

    // Movement: Constant Rightward Motion
    player.setVelocityX(cursors.right.isDown ? baseSpeed + manualBoost : baseSpeed);

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
        if (distance < 400) {
            badGuy.setVelocityX(-100);
            badGuy.setTint(0xff0000); 
        }
        else if (distance > 400) {
            badGuy.setVelocityX(100);
            badGuy.setTint(0xff0000); 
        }
    });

    cleanupObjects.call(this);

    // Refresh HUD
    score = Math.floor(player.x / 100);
    scoretext.setText('Score: ' + score);
    flyText.setText('Fuel: ' + Math.ceil(flytime));
    bullettext.setText('Bullets: ' + bullets);
    healthtext.setText('Health: ' + health);
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
}

/**
 * Instantiates a bullet and notifies the server.
 */
function fireBullet() {
    bullets--;
    const b = bulletGroup.create(player.x + 20, player.y, 'bullet');
    b.body.allowGravity = false;
    b.setVelocityX(600);
    this.time.delayedCall(2000, () => { if (b.active) b.destroy(); });

    this.socket.emit('playerShoots', { 
        x: b.x, y: b.y, velocityX: 600, ownerId: this.socket.id 
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
    if (item.type === 'jetpack') flytime = Math.min(flytime + 200, 1000);
    else if (item.type === 'gun') bullets = Math.min(bullets + 10, 30);
    else if (item.type === 'health') health = Math.min(health + 20, 100);
    item.destroy();
}

// Infinite recursive spawning loops
function spawnRandomSpike() {
    if (this.physics.world.isPaused) return;
    let spawnX = this.cameras.main.scrollX + 900;
    let spike = spikes.create(spawnX, 550, Phaser.Math.RND.pick(spikeTypes));
    spike.setImmovable(true).body.allowGravity = false;
    this.time.delayedCall(Phaser.Math.Between(1500, 4000), spawnRandomSpike, [], this);
}

function spawnRandomBrick() {
    if (this.physics.world.isPaused) return;
    spawnBrick.call(this);
    this.time.delayedCall(Phaser.Math.Between(1000, 4000), spawnRandomBrick, [], this);
}

/**
 * Memory Management: Removes objects that have scrolled off-screen.
 */
function cleanupObjects() {
    [spikes, bricks, items, enemy, bulletGroup, this.networkBullets].forEach(group => {
        if(!group) return;
        group.getChildren().forEach(child => {
            if (child.x < this.cameras.main.scrollX - 150) child.destroy();
        });
    });
}