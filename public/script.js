/** 
 * CRAZY MULTIPLAYER GAME
 */
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 1000 },
            debug: false
        }
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

let spikes, bricks, items, enemy, bulletGroup;
let scoretext, flyText, bullettext, healthtext;

let baseSpeed = 350;
let manualBoost = 150;

let spikeTypes = ['spike1', 'spike2', 'spike3', 'spike4', 'spike6', 'spike7', 'spike8', 'spike9', 'enemy'];
let brickTypes = ['brick1', 'brick2', 'brick3', 'brick4', 'brick5', 'brick6', 'brick7', 'brick8'];
let itemTypes = ['jetpack', 'gun', 'health'];

// Multiplayer vars
let socket;

function preload() {
    this.load.image('box', 'assets/1box.png');
    this.load.image('ground', 'assets/ground.png');
    this.load.image('bg', 'assets/bg.png');
    this.load.image('bullet', 'assets/bullet.png');
    this.load.image('jetpack', 'assets/jetpack.png');
    this.load.image('gun', 'assets/gun.png');
    this.load.image('health', 'assets/health.png');
    this.load.image('enemy', 'assets/enemy.png');

    spikeTypes.forEach(s => this.load.image(s, `assets/${s}.png`));
    brickTypes.forEach(b => this.load.image(b, `assets/${b}.png`));
}

function create() {
    // --- SOCKET.IO INIT ---
    this.socket = io();
    this.otherPlayers = this.physics.add.group();
    this.networkBullets = this.physics.add.group({ defaultKey: 'bullet', maxSize: 30 });

    // --- RECEIVE CURRENT PLAYERS ---
    this.socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach(id => {
            if (id !== this.socket.id) addOtherPlayer.call(this, players[id]);
        });
    });

    this.socket.on('newPlayer', (playerInfo) => addOtherPlayer.call(this, playerInfo));

    this.socket.on('playerDisconnected', (playerId) => {
        this.otherPlayers.getChildren().forEach(p => { if (p.playerId === playerId) p.destroy(); });
    });

    this.socket.on('playerMoved', (playerInfo) => {
        this.otherPlayers.getChildren().forEach(p => { 
            if (playerInfo.playerId === p.playerId) p.setPosition(playerInfo.x, playerInfo.y); 
        });
    });

    this.socket.on('bulletFired', (bulletData) => {
        const bullet = this.networkBullets.create(bulletData.x, bulletData.y, 'bullet');
        if (bullet) {
            bullet.body.allowGravity = false;
            bullet.setVelocityX(bulletData.velocityX);
            bullet.ownerId = bulletData.ownerId;
            this.time.delayedCall(2000, () => { if (bullet.active) bullet.destroy(); });
        }
    });

    this.socket.on('playerWasHit', (hitInfo) => {
        if (hitInfo.playerId === this.socket.id) {
            health = hitInfo.health;
            player.setTint(0xff0000);
            this.time.delayedCall(200, () => player.clearTint());
            if (health <= 0) {
                this.physics.pause();
                window.alert("You have been eliminated!");
            }
        } else {
            this.otherPlayers.getChildren().forEach(p => {
                if (hitInfo.playerId === p.playerId) {
                    p.setTint(0xff0000);
                    this.time.delayedCall(200, () => p.clearTint());
                }
            });
        }
    });

    // --- BACKGROUND & GROUND ---
    this.bg = this.add.tileSprite(400, 300, 800, 600, 'bg').setScrollFactor(0);
    ground = this.add.tileSprite(400, 580, 800, 32, 'ground');
    this.physics.add.existing(ground, true);

    // --- PLAYER SETUP ---
    player = this.physics.add.image(100, 450, 'box');
    this.physics.add.collider(player, ground);

    this.cameras.main.startFollow(player, true, 0.1, 0.1);
    this.cameras.main.setFollowOffset(-250, 150);

    // --- INPUTS ---
    cursors = this.input.keyboard.createCursorKeys();
    spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    // --- GROUPS ---
    spikes = this.physics.add.group();
    bricks = this.physics.add.group();
    items = this.physics.add.group();
    enemy = this.physics.add.group();
    bulletGroup = this.physics.add.group();

    // --- COLLISIONS ---
    this.physics.add.collider(player, spikes, hitspike, null, this);
    this.physics.add.collider(player, enemy, hitspike, null, this);
    this.physics.add.collider(player, bricks);
    this.physics.add.overlap(player, items, collectItem, null, this);
    this.physics.add.collider(enemy, ground);
    this.physics.add.collider(enemy, bricks);
    this.physics.add.collider(this.otherPlayers, ground);
    this.physics.add.collider(this.otherPlayers, bricks);

    // Player hit by network bullets
    this.physics.add.overlap(player, this.networkBullets, (p, b) => {
        if (b.ownerId !== this.socket.id) {
            this.socket.emit('playerHit', { playerId: this.socket.id });
            b.destroy();
        }
    }, null, this);

    // Bullet collisions
    this.physics.add.collider(bulletGroup, enemy, (bullet, enmy) => {
        bullet.destroy();
        enmy.destroy();
        score += 20;
    });
    this.physics.add.collider(bulletGroup, spikes, (bullet, s) => {
        bullet.destroy();
        s.destroy();
        score += 10;
    });

    // --- UI ---
    scoretext = this.add.text(40, 40, 'Score: 0', { fontSize: '32px', fill: '#000' }).setScrollFactor(0);
    flyText = this.add.text(40, 80, 'Fuel: 1000', { fontSize: '24px', fill: '#000' }).setScrollFactor(0);
    healthtext = this.add.text(580, 40, 'Health: 100', { fontSize: '24px', fill: '#000' }).setScrollFactor(0);
    bullettext = this.add.text(580, 80, 'Bullets: 10', { fontSize: '24px', fill: '#000' }).setScrollFactor(0);

    // --- START SPAWN LOOPS ---
    spawnRandomSpike.call(this);
    spawnRandomBrick.call(this);
}

// --- GAME LOOP ---
function update() {
    if (this.physics.world.isPaused || !player) return;

    // BACKGROUND & GROUND PARALLAX
    this.bg.tilePositionX = this.cameras.main.scrollX * 0.3;
    ground.x = this.cameras.main.scrollX + 400;
    ground.body.x = this.cameras.main.scrollX;
    ground.tilePositionX = this.cameras.main.scrollX;

    // --- PLAYER MOVEMENT ---
    if (cursors.up.isDown && flytime > 0) {
        player.setVelocityY(-300);
        flytime -= 2;
        player.setAngle(-15);
        this.cameras.main.zoomTo(0.7, 1000);
    } else {
        this.cameras.main.zoomTo(1, 1000);
        player.setAngle(0);
        if (player.body.touching.down) player.setAngularVelocity(0);
    }

    if (Phaser.Input.Keyboard.JustDown(spaceKey) && player.body.touching.down) {
        player.setVelocityY(-450);
        player.setAngularVelocity(300);
    }

    player.setVelocityX(cursors.right.isDown ? baseSpeed + manualBoost : baseSpeed);

    if (Phaser.Input.Keyboard.JustDown(enterKey) && bullets > 0) {
        fireBullet.call(this);
    }

    // --- EMIT MOVEMENT ---
    if (player.oldPosition && (player.x !== player.oldPosition.x || player.y !== player.oldPosition.y)) {
        this.socket.emit('playerMovement', { x: player.x, y: player.y });
    }
    player.oldPosition = { x: player.x, y: player.y };

    // --- ENEMY AI ---
    enemy.getChildren().forEach(b => {
        if (b.isJumper && b.body.touching.down && Phaser.Math.Between(0, 100) > 98) b.setVelocityY(-400);
        if (b.x < this.cameras.main.scrollX - 100) b.destroy();
    });

    // --- CLEANUP & UI ---
    cleanupObjects.call(this);
    score = Math.floor(player.x / 100);
    scoretext.setText('Score: ' + score);
    flyText.setText('Fuel: ' + Math.ceil(flytime));
    bullettext.setText('Bullets: ' + bullets);
    healthtext.setText('Health: ' + health);
}

// --- HELPER FUNCTIONS ---
function spawnBrick() {
    let randomBrickKey = Phaser.Math.RND.pick(brickTypes);
    let spawnX = this.cameras.main.scrollX + 900;
    let randomY = Phaser.Math.Between(120, 500);

    let brick = bricks.create(spawnX, randomY, randomBrickKey);
    brick.setImmovable(true).body.allowGravity = false;

    let chance = Phaser.Math.Between(0, 100);
    if (chance > 70) {
        let type = Phaser.Math.RND.pick(itemTypes);
        enemy.create(spawnX, randomY - 20, 'enemy');
        let item = items.create(spawnX, randomY - 65, type);
        item.body.allowGravity = false;
        item.type = type;
    } else if (chance > 40) {
        let badGuy = enemy.create(spawnX, randomY - 45, 'enemy');
        badGuy.body.allowGravity = true;
        badGuy.setBounce(0.2);
    }
}

function hitspike(player, spike) {
    spike.destroy();
    health -= 10;
    player.setTint(0xff0000);
    this.time.delayedCall(200, () => player.clearTint());
    if (health <= 0) {
        this.physics.pause();
        this.time.delayedCall(1000, () => window.alert("You loose"));
    }
}

function fireBullet() {
    if (bullets > 0) {
        bullets--;
        let bullet = bulletGroup.create(player.x + 20, player.y, 'bullet');
        bullet.body.allowGravity = false;
        bullet.setVelocityX(600);
        this.time.delayedCall(2000, () => { if (bullet.active) bullet.destroy(); });
        this.socket.emit('playerShoots', { x: bullet.x, y: bullet.y, velocityX: 600, ownerId: this.socket.id });
    }
}

function collectItem(player, item) {
    if (item.type === 'jetpack') flytime = Math.min(flytime + 200, 1000);
    else if (item.type === 'gun') bullets += 10;
    else if (item.type === 'health') health = Math.min(health + 20, 100);
    item.destroy();
}

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

function cleanupObjects() {
    [spikes, bricks, items, enemy, bulletGroup].forEach(group => {
        group.getChildren().forEach(c => { if (c.x < this.cameras.main.scrollX - 100) c.destroy(); });
    });
}

function addOtherPlayer(playerInfo) {
    const otherPlayer = this.physics.add.image(playerInfo.x, playerInfo.y, 'box');
    otherPlayer.setTint(0x0000ff);
    otherPlayer.playerId = playerInfo.playerId;
    this.otherPlayers.add(otherPlayer);
}
