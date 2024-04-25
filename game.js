import * as THREE from 'three';
import { PointerLockControls } from './PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const playerHeight = 1;

let camera, scene, renderer, light, sun, controls, raycaster, fog;

let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let canJump = false;

let grappleTarget = undefined;
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

let spawnPoint = new THREE.Vector3(0, playerHeight, 0);
let objects = [];
let animatedObjects = [];
let loader = new GLTFLoader();
let clock = new THREE.Clock();
let isLoading = true;

let materialList = [
    'textures/default.png',
    'textures/grabbable.png',
    'textures/ice.png',
    'textures/lava.png',
    'textures/wood.png',
    'textures/grapplable.png',
    'textures/grapplable_lava.png',
    'textures/grabbable_crumbling.png',
    'textures/default_colored.png',
    'textures/bouncing.png'
];
let shapeList = [
    'models/cube.glb',
    'models/sphere.glb',
    'models/cylinder.glb',
    'models/pyramid.glb',
    'models/prism.glb',
    'models/sign.glb',
    'models/start_end.glb'
];

let startMaterial, finishMaterial;
let materials = [];
let shapes = [];

let PROTOBUF_DATA = `
syntax = "proto3";

package COD.Level;

message Level
{
  uint32 formatVersion = 1;

  string title = 2;
  string creators = 3;
  string description = 4;
  uint32 complexity = 5;
  uint32 maxCheckpointCount = 7;

  AmbienceSettings ambienceSettings = 8;

  repeated LevelNode levelNodes = 6;
}

message Vector
{
	float x = 1;
	float y = 2;
	float z = 3;
}

message Quaternion
{
	float x = 1;
	float y = 2;
	float z = 3;
	float w = 4;
}

message Color
{
	float r = 1;
	float g = 2;
	float b = 3;
	float a = 4;
}

message AmbienceSettings
{
	Color skyZenithColor = 1;
	Color skyHorizonColor = 2;

	float sunAltitude = 3;
	float sunAzimuth = 4;
	float sunSize = 5;

	float fogDDensity = 6;
}

enum LevelNodeShape
{
	START = 0;
	FINISH = 1;
	SIGN = 2;

	__END_OF_SPECIAL_PARTS__ = 3;

	CUBE = 1000;
	SPHERE = 1001;
	CYLINDER = 1002;
	PYRAMID = 1003;
	PRISM = 1004;
}

enum LevelNodeMaterial
{
	DEFAULT = 0;
	GRABBABLE = 1;
	ICE = 2;
	LAVA = 3;
	WOOD = 4;
	GRAPPLABLE = 5;
	GRAPPLABLE_LAVA = 6;

	GRABBABLE_CRUMBLING= 7;
	DEFAULT_COLORED = 8;
	BOUNCING = 9;
}

message LevelNodeGroup
{
	Vector position = 1;
	Vector scale = 2;
	Quaternion rotation = 3;

	repeated LevelNode childNodes = 4;
}

message LevelNodeStart
{
	Vector position = 1;
	Quaternion rotation = 2;
	float radius = 3;
}

message LevelNodeFinish
{
	Vector position = 1;
	float radius = 2;
}

message LevelNodeStatic
{
	LevelNodeShape shape = 1;
	LevelNodeMaterial material = 2;

	Vector position = 3;
	Vector scale = 4;
	Quaternion rotation = 5;

	Color color = 6;
	bool isNeon = 7;
}

message LevelNodeCrumbling
{
	LevelNodeShape shape = 1;
	LevelNodeMaterial material = 2;

	Vector position = 3;
	Vector scale = 4;
	Quaternion rotation = 5;

	float stableTime = 6;
	float respawnTime = 7;
}

message LevelNodeSign
{
	Vector position = 1;
	Quaternion rotation = 2;

	string text = 3;
}

message AnimationFrame
{
	float time = 1;
	Vector position = 2;
	Quaternion rotation = 3;
}

message Animation
{
	enum Direction
	{
		RESTART = 0;
		PINGPONG = 1;
	}

	string name = 1;
	repeated AnimationFrame frames = 2;
	Direction direction = 3;
	float speed = 4;
}

message LevelNode
{
	bool isLocked = 6;

	oneof content
	{
		LevelNodeStart levelNodeStart = 1;
		LevelNodeFinish levelNodeFinish = 2;
		LevelNodeStatic levelNodeStatic = 3;
		LevelNodeSign levelNodeSign = 4;
		LevelNodeCrumbling levelNodeCrumbling = 5;
		LevelNodeGroup levelNodeGroup = 7;
	}

	repeated Animation animations = 15;
}
`
const vertexShader = /*glsl*/`

varying vec3 vWorldPosition;
varying vec3 vNormal;

uniform mat3 worldNormalMatrix;

void main()
{
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;

    vNormal = worldNormalMatrix * normal;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const fragmentShader = /*glsl*/`

varying vec3 vWorldPosition;
varying vec3 vNormal;

uniform vec3 colors;
uniform float opacity;
uniform sampler2D colorTexture;
uniform float tileFactor;

const float gamma = 0.5;

void main()
{
    vec4 color = vec4(colors, opacity);
    vec3 blendNormals = abs(vNormal);
    vec3 texSample;
    vec4 adjustment = vec4(1.0, 1.0, 1.0, 1.0);

    if(blendNormals.x > blendNormals.y && blendNormals.x > blendNormals.z)
    {
        texSample = texture2D(colorTexture, vWorldPosition.zy * tileFactor).rgb;
    }
    else if(blendNormals.y > blendNormals.z)
    {
        texSample = texture2D(colorTexture, vWorldPosition.xz * tileFactor).rgb;
    }
    else
    {
        texSample = texture2D(colorTexture, vWorldPosition.xy * tileFactor).rgb;
    }

    texSample = pow(texSample, vec3(1.0 / gamma));

    color.rgb *= texSample * adjustment.rgb;
    gl_FragColor = LinearTosRGB(color);
}`;
const startFinishVS = /*glsl*/`
varying vec2 vTexcoord;

void main()
{
    vTexcoord = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const startFinishFS = /*glsl*/`
varying vec2 vTexcoord;

uniform vec4 diffuseColor;

void main()
{
    vec4 color = diffuseColor;
    float factor = vTexcoord.y;
    factor *= factor * factor;
    factor = clamp(factor, 0.0, 1.0);
    color.a = factor;

    gl_FragColor = color;
}`;


function loadTexture(path) {
    return new Promise((resolve) => {
        const texture = new THREE.TextureLoader().load(path, function (texture) {
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            resolve(texture);
        });
    });
}

function loadModel(path) {
    return new Promise((resolve) => {
        loader.load(path, function (gltf) {
            const glftScene = gltf.scene;
            resolve(glftScene.children[0]);
        });
    });
}

async function initAttributes() {
    for (const path of materialList) {
        const texture = await loadTexture(path);
        let material = new THREE.ShaderMaterial({
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            uniforms: {
                "colorTexture": { value: texture },
                "tileFactor": { value: 1.1 },
                "worldNormalMatrix": { value: new THREE.Matrix3() },
                "colors": { value: new THREE.Vector3(1.0, 1.0, 1.0) },
                "opacity": { value: 1.0 },
            }
        });
        materials.push(material);
    }

    for (const path of shapeList) {
        const model = await loadModel(path);
        shapes.push(model);
    }

    startMaterial = new THREE.ShaderMaterial();
	startMaterial.vertexShader = startFinishVS;
	startMaterial.fragmentShader = startFinishFS;
	startMaterial.flatShading = true;
	startMaterial.transparent = true;
	startMaterial.depthWrite = false;
	startMaterial.uniforms = { "diffuseColor": {value: [0.0, 1.0, 0.0, 1.0]}};

	finishMaterial = new THREE.ShaderMaterial();
	finishMaterial.vertexShader = startFinishVS;
	finishMaterial.fragmentShader = startFinishFS;
	finishMaterial.flatShading = true;
	finishMaterial.transparent = true;
	finishMaterial.depthWrite = false;
	finishMaterial.uniforms = { "diffuseColor": {value: [1.0, 0.0, 0.0, 1.0]}};
}

function readArrayBuffer(file) {
    return new Promise(function(resolve, reject) {
        let reader = new FileReader();
        reader.onload = function() {
            let data = reader.result;
            let {root} = protobuf.parse(PROTOBUF_DATA, { keepCase: true });
            console.log(root);
            let message = root.lookupType("COD.Level.Level");
            let decoded = message.decode(new Uint8Array(data));
            let object = message.toObject(decoded);
            resolve(object);
        }
        reader.onerror = function() {
            reject(reader);
        }
        reader.readAsArrayBuffer(file);
    });
}

async function openProto(link) {
    let response = await fetch(link);
    let data = await response.arrayBuffer();

    let blob = new Blob([data]);
    let level = await readArrayBuffer(blob);
    
    return level;
}

async function init() {

    renderer = new THREE.WebGLRenderer({alpha: true, antialias: true});
    renderer.setSize( window.innerWidth, window.innerHeight );
    document.getElementById("viewport").appendChild( renderer.domElement );
    renderer.setPixelRatio(window.devicePixelRatio);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 5000 );
    camera.position.set( 0, playerHeight, 0 );

    light = new THREE.AmbientLight(0xffffff);
    scene.add(light);
    sun = new THREE.DirectionalLight( 0xffffff, 0.5 );
    scene.add( sun );

    controls = new PointerLockControls( camera, renderer.domElement );
    scene.add( controls.getObject() );

    window.addEventListener( 'resize', onWindowResize );

    window.addEventListener( 'keydown', handleKey);
    window.addEventListener( 'keyup', handleKeyUp);

    window.addEventListener( 'mousedown', onWindowClick );
    window.addEventListener( 'mouseup', onWindowRelease );

    raycaster = new THREE.Raycaster( new THREE.Vector3(), new THREE.Vector3( 0, - 1, 0 ), 0, playerHeight );

    let randomButton = document.getElementById("randomButton");
    let forwardsButton = document.getElementById("forwardsButton");
    let leftButton = document.getElementById("leftButton");
    let backwardsButton = document.getElementById("backwardsButton");
    let rightButton = document.getElementById("rightButton");
    let jumpButton = document.getElementById("jumpButton");
    randomButton.addEventListener( 'click', loadRandomLevel);
    forwardsButton.addEventListener( 'touchstart', () => { moveForward = true; });
    forwardsButton.addEventListener( 'touchend', () => { moveForward = false; });
    leftButton.addEventListener( 'touchstart', () => { moveLeft = true; });
    leftButton.addEventListener( 'touchend', () => { moveLeft = false; });
    backwardsButton.addEventListener( 'touchstart', () => { moveBackward = true; });
    backwardsButton.addEventListener( 'touchend', () => { moveBackward = false; });
    rightButton.addEventListener( 'touchstart', () => { moveRight = true; });
    rightButton.addEventListener( 'touchend', () => { moveRight = false; });
    jumpButton.addEventListener( 'click', () => { 
        if ( canJump === true ) {
            velocity.y += 8;
        }
        canJump = false;
    });
    jumpButton.addEventListener( 'dblclick', () => {
        if ( canJump === true ) {
            velocity.y += 16;
        }
        canJump = false;
    });

    let mobileControls = document.getElementById("mobile-controls");
    let jumpControls = document.getElementById("jump-controls");
    // mobile
    if (( 'ontouchstart' in window ) || 
    ( navigator.maxTouchPoints > 0 ) || 
    ( navigator.msMaxTouchPoints > 0 )) {
        mobileControls.style.display = "grid";
        jumpControls.style.display = "grid";
    }

    await initAttributes();

    await loadRandomLevel();

    animate();
}

async function loadRandomLevel() {
    let levelUrl = "https://api.slin.dev/grab/v1/get_random_level?type=ok";
    const levelResponse = await fetch(levelUrl);
    const levelData = await levelResponse.json();
    const downloadUrl = `https://api.slin.dev/grab/v1/download/${levelData.data_key.replace("level_data:", "").split(":").join("/")}`;
    let level =  await openProto(downloadUrl);
    await loadLevel(level);
}

async function loadLevel(level) {
    scene = new THREE.Scene();
    objects = [];
    animatedObjects = [];
    objects.push(controls.getObject());

    velocity.x = 0;
    velocity.y = 0;
    velocity.z = 0;
    
    scene.add(light);
    scene.add(sun);
    scene.add(camera);

    level.levelNodes.forEach(node => {
        loadLevelNode(node, scene);
    });

    let ambience = level.ambienceSettings;
    let sky = [
        [0, 0, 0],
        [0, 0, 0]
    ];
    
    if (ambience) {
        if (ambience.skyZenithColor) {
            sky[0][0] = (ambience?.skyZenithColor?.r || 0) * 255;
            sky[0][1] = (ambience?.skyZenithColor?.g || 0) * 255;
            sky[0][2] = (ambience?.skyZenithColor?.b || 0) * 255;
        }
        if (ambience.skyHorizonColor) {
            sky[1][0] = (ambience?.skyHorizonColor?.r || 0) * 255;
            sky[1][1] = (ambience?.skyHorizonColor?.g || 0) * 255;
            sky[1][2] = (ambience?.skyHorizonColor?.b || 0) * 255;
        }
    }

    let fogDensity = 200 - (1 - (ambience?.fogDDensity || 0) * 180);
    fog = new THREE.Fog(new THREE.Color(
        sky[0][0],
        sky[0][1],
        sky[0][2]
    ), fogDensity, 1000);

    scene.fog = fog;

    document.body.style.backgroundImage = `linear-gradient(rgb(${sky[0][0]}, ${sky[0][1]}, ${sky[0][2]}), rgb(${sky[1][0]}, ${sky[1][1]}, ${sky[1][2]}), rgb(${sky[0][0]}, ${sky[0][1]}, ${sky[0][2]}))`;
    
    console.log(level);
    console.log(objects);
    console.log(scene);
    isLoading = false;
}

function loadLevelNode(node, parent) {
    let object = undefined;
    if (node.levelNodeGroup) {
        object = new THREE.Object3D();
        objects.push( object );
        parent.add( object );

        object.position.x = node.levelNodeGroup.position.x || 0;
        object.position.y = node.levelNodeGroup.position.y || 0;
        object.position.z = node.levelNodeGroup.position.z || 0;
        object.scale.x = node.levelNodeGroup.scale.x || 0;
        object.scale.y = node.levelNodeGroup.scale.y || 0;
        object.scale.z = node.levelNodeGroup.scale.z || 0;
        object.quaternion.x = node.levelNodeGroup.rotation.x || 0;
        object.quaternion.y = node.levelNodeGroup.rotation.y || 0;
        object.quaternion.z = node.levelNodeGroup.rotation.z || 0;
        object.quaternion.w = node.levelNodeGroup.rotation.w || 0;
        
        object.initialPosition = object.position.clone();
        object.initialRotation = object.quaternion.clone();
        
        node.levelNodeGroup.childNodes.forEach(node => {
            loadLevelNode(node, object);
        });
    } else if (node.levelNodeGravity) {

        let particleGeometry = new THREE.BufferGeometry();

        let particleColor = new THREE.Color(1.0, 1.0, 1.0);
        if (node.levelNodeGravity?.mode == 1) {
            particleColor = new THREE.Color(1.0, 0.6, 0.6);
        }
        let particleMaterial = new THREE.PointsMaterial({ color: particleColor, size: 0.05 });

        object = new THREE.Object3D()
        parent.add(object);

        object.position.x = node.levelNodeGravity.position.x || 0;
        object.position.y = node.levelNodeGravity.position.y || 0;
        object.position.z = node.levelNodeGravity.position.z || 0;

        object.scale.x = node.levelNodeGravity.scale.x || 0;
        object.scale.y = node.levelNodeGravity.scale.y || 0;
        object.scale.z = node.levelNodeGravity.scale.z || 0;

        object.quaternion.x = node.levelNodeGravity.rotation.x || 0;
        object.quaternion.y = node.levelNodeGravity.rotation.y || 0;
        object.quaternion.z = node.levelNodeGravity.rotation.z || 0;
        object.quaternion.w = node.levelNodeGravity.rotation.w || 0;

        object.initialPosition = object.position.clone();
        object.initialRotation = object.quaternion.clone();

        let particleCount = Math.floor(object.scale.x * object.scale.y * object.scale.z)
        particleCount = Math.min(particleCount, 2000);
        let particlePositions = [];

        for (let i = 0; i < particleCount; i++) {
            let x = (Math.random() - 0.5) * object.scale.x;
            let y = (Math.random() - 0.5) * object.scale.y;
            let z = (Math.random() - 0.5) * object.scale.z;

            particlePositions.push(x, y, z);
        }

        particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(particlePositions, 3));
        let particles = new THREE.Points(particleGeometry, particleMaterial);
        object.add(particles);
        objects.push(object);
    } else if (node.levelNodeStatic) { 
        if (node.levelNodeStatic.shape-1000 >= 0 && node.levelNodeStatic.shape-1000 < shapes.length) {
            object = shapes[node.levelNodeStatic.shape-1000].clone();
        } else {
            object = shapes[0].clone();
        }
        let material = materials[0].clone();
        if (node.levelNodeStatic.material && node.levelNodeStatic.material >= 0 && node.levelNodeStatic.material < materials.length) {
            material = materials[node.levelNodeStatic.material].clone();
        }
        if (node.levelNodeStatic.material == 8) {
            node.levelNodeStatic.color.r ? null : node.levelNodeStatic.color.r = 0;
            node.levelNodeStatic.color.g ? null : node.levelNodeStatic.color.g = 0;
            node.levelNodeStatic.color.b ? null : node.levelNodeStatic.color.b = 0;
            material.uniforms.colors.value = new THREE.Vector3(node.levelNodeStatic.color.r, node.levelNodeStatic.color.g, node.levelNodeStatic.color.b);
            if (node.levelNodeStatic.isNeon) {
                //
            }
        }
        object.material = material;
        parent.add(object);
        object.position.x = node.levelNodeStatic.position.x || 0;
        object.position.y = node.levelNodeStatic.position.y || 0;
        object.position.z = node.levelNodeStatic.position.z || 0;
        object.quaternion.w = node.levelNodeStatic.rotation.w || 0;
        object.quaternion.x = node.levelNodeStatic.rotation.x || 0;
        object.quaternion.y = node.levelNodeStatic.rotation.y || 0;
        object.quaternion.z = node.levelNodeStatic.rotation.z || 0;
        object.scale.x = node.levelNodeStatic.scale.x || 0;
        object.scale.y = node.levelNodeStatic.scale.y || 0;
        object.scale.z = node.levelNodeStatic.scale.z || 0;

        object.initialPosition = object.position.clone();
        object.initialRotation = object.quaternion.clone();

        let targetVector = new THREE.Vector3();
        let targetQuaternion = new THREE.Quaternion();
        let worldMatrix = new THREE.Matrix4();
        worldMatrix.compose(
            object.getWorldPosition(targetVector), 
            object.getWorldQuaternion(targetQuaternion), 
            object.getWorldScale(targetVector)
        );

        let normalMatrix = new THREE.Matrix3();
        normalMatrix.getNormalMatrix(worldMatrix);
        material.uniforms.worldNormalMatrix.value = normalMatrix;

        objects.push(object);

    } else if (node.levelNodeCrumbling) {
        let material;
        if (node.levelNodeCrumbling.shape-1000 >= 0 && node.levelNodeCrumbling.shape-1000 < shapes.length) {
            object = shapes[node.levelNodeCrumbling.shape-1000].clone();
        } else {
            object = shapes[0].clone();
        }
        material = materials[7].clone();

        object.material = material;
        parent.add(object);
        object.position.x = node.levelNodeCrumbling.position.x || 0;
        object.position.y = node.levelNodeCrumbling.position.y || 0;
        object.position.z = node.levelNodeCrumbling.position.z || 0;
        object.quaternion.w = node.levelNodeCrumbling.rotation.w || 0;
        object.quaternion.x = node.levelNodeCrumbling.rotation.x || 0;
        object.quaternion.y = node.levelNodeCrumbling.rotation.y || 0;
        object.quaternion.z = node.levelNodeCrumbling.rotation.z || 0;
        object.scale.x = node.levelNodeCrumbling.scale.x || 0;
        object.scale.y = node.levelNodeCrumbling.scale.y || 0;
        object.scale.z = node.levelNodeCrumbling.scale.z || 0;

        object.initialPosition = object.position.clone();
        object.initialRotation = object.quaternion.clone();

        let targetVector = new THREE.Vector3();
        let targetQuaternion = new THREE.Quaternion();
        let worldMatrix = new THREE.Matrix4();
        worldMatrix.compose(
            object.getWorldPosition(targetVector), 
            object.getWorldQuaternion(targetQuaternion), 
            object.getWorldScale(targetVector)
        );

        let normalMatrix = new THREE.Matrix3();
        normalMatrix.getNormalMatrix(worldMatrix);
        material.uniforms.worldNormalMatrix.value = normalMatrix;

        objects.push(object);
        
    } else if (node.levelNodeSign) {
        object = shapes[5].clone();
        object.material = materials[4].clone();
        parent.add(object);
        object.position.x = node.levelNodeSign.position.x || 0;
        object.position.y = node.levelNodeSign.position.y || 0;
        object.position.z = node.levelNodeSign.position.z || 0;
        object.quaternion.w = node.levelNodeSign.rotation.w || 0;
        object.quaternion.x = node.levelNodeSign.rotation.x || 0;
        object.quaternion.y = node.levelNodeSign.rotation.y || 0;
        object.quaternion.z = node.levelNodeSign.rotation.z || 0;
        
        object.initialPosition = object.position.clone();
        object.initialRotation = object.quaternion.clone();
        
        objects.push(object);
    } else if (node.levelNodeStart) {
        object = shapes[6].clone();
        object.material = startMaterial;
        parent.add(object);
        object.position.x = node.levelNodeStart.position.x || 0;
        object.position.y = node.levelNodeStart.position.y || 0;
        object.position.z = node.levelNodeStart.position.z || 0;
        object.quaternion.w = node.levelNodeStart.rotation.w || 0;
        object.quaternion.x = node.levelNodeStart.rotation.x || 0;
        object.quaternion.y = node.levelNodeStart.rotation.y || 0;
        object.quaternion.z = node.levelNodeStart.rotation.z || 0;
        object.scale.x = node.levelNodeStart.radius || 0;
        object.scale.z = node.levelNodeStart.radius || 0;

        object.initialPosition = object.position.clone();
        object.initialRotation = object.quaternion.clone();

        objects.push(object);
        camera.position.set(object.position.x, object.position.y + playerHeight, object.position.z);
        spawnPoint.set(object.position.x, object.position.y + playerHeight, object.position.z);

    } else if (node.levelNodeFinish) {
        object = shapes[6].clone();
        object.material = finishMaterial;
        parent.add(object);
        object.position.x = node.levelNodeFinish.position.x || 0;
        object.position.y = node.levelNodeFinish.position.y || 0;
        object.position.z = node.levelNodeFinish.position.z || 0;
        object.scale.x = node.levelNodeFinish.radius || 0;
        object.scale.z = node.levelNodeFinish.radius || 0;

        object.initialPosition = object.position.clone();
        object.initialRotation = object.quaternion.clone();

        objects.push(object);
    }
    if (object !== undefined) {
        object.grabNodeData = node;
        if(node.animations && node.animations.length > 0 && node.animations[0].frames && node.animations[0].frames.length > 0) {
            for (let frame of node.animations[0].frames) {
                frame.position.x = frame.position.x || 0;
                frame.position.y = frame.position.y || 0;
                frame.position.z = frame.position.z || 0;
                frame.rotation.x = frame.rotation.x || 0;
                frame.rotation.y = frame.rotation.y || 0;
                frame.rotation.z = frame.rotation.z || 0;
                frame.rotation.w = frame.rotation.w || 0;
                frame.time = frame.time || 0;
            }
            object.animation = node.animations[0]
            object.animation.currentFrameIndex = 0
            animatedObjects.push(object)
        }
    }
}

function updateObjectAnimation(object, time) {
	let animation = object.animation
	const animationFrames = animation.frames
	const relativeTime = (time * object.animation.speed) % animationFrames[animationFrames.length - 1].time;

    if (!animation.currentFrameIndex) {
        animation.currentFrameIndex = 0;
    }
	
	let oldFrame = animationFrames[animation.currentFrameIndex];
	let newFrameIndex = animation.currentFrameIndex + 1;
	if(newFrameIndex >= animationFrames.length) newFrameIndex = 0;
	let newFrame = animationFrames[newFrameIndex];

	let loopCounter = 0;
	while(loopCounter <= animationFrames.length)
	{
		oldFrame = animationFrames[animation.currentFrameIndex];
		newFrameIndex = animation.currentFrameIndex + 1;
		if(newFrameIndex >= animationFrames.length) newFrameIndex = 0;
		newFrame = animationFrames[newFrameIndex];
		
		if(oldFrame.time <= relativeTime && newFrame.time > relativeTime) break;
		animation.currentFrameIndex += 1;
		if(animation.currentFrameIndex >= animationFrames.length - 1) animation.currentFrameIndex = 0;
		
		loopCounter += 1;
	}

	let factor = 0.0
	let timeDiff = (newFrame.time - oldFrame.time);
	if(Math.abs(timeDiff) > 0.00000001)
	{
		factor = (relativeTime - oldFrame.time) / timeDiff;
	}

	const oldRotation = new THREE.Quaternion( oldFrame.rotation.x, oldFrame.rotation.y, oldFrame.rotation.z, oldFrame.rotation.w )
	const newRotation = new THREE.Quaternion( newFrame.rotation.x, newFrame.rotation.y, newFrame.rotation.z, newFrame.rotation.w )
	const finalRotation = new THREE.Quaternion()
	finalRotation.slerpQuaternions(oldRotation, newRotation, factor)

	const oldPosition = new THREE.Vector3( oldFrame.position.x, oldFrame.position.y, oldFrame.position.z )
	const newPosition = new THREE.Vector3( newFrame.position.x, newFrame.position.y, newFrame.position.z )
	const finalPosition = new THREE.Vector3()
	finalPosition.lerpVectors(oldPosition, newPosition, factor)

	object.position.copy(object.initialPosition).add(finalPosition.applyQuaternion(object.initialRotation))
	object.quaternion.multiplyQuaternions(object.initialRotation, finalRotation)
}

function animate() {
    requestAnimationFrame( animate );

    let delta = clock.getDelta();
    
    let speed = 80.0;

    raycaster.ray.origin.copy( controls.getObject().position );

    const intersections = raycaster.intersectObjects( objects, false );

    const onObject = intersections.length > 0;

    velocity.x -= velocity.x * 10.0 * delta;
    velocity.z -= velocity.z * 10.0 * delta;

    velocity.y -= 9.8 * 5.0 * delta; // 100.0 = mass

    if ( onObject === true ) {

        if ( intersections[0]?.object?.grabNodeData?.levelNodeStatic?.material == 9) {
            velocity.y = Math.abs(velocity.y * 0.8);
        }

        velocity.y = Math.max( 0, velocity.y );
        canJump = true;

        if (intersections[0].point.y > controls.getObject().position.y - playerHeight / 2) {
            velocity.y += 1.0;
        }
        if (intersections[0].point.y > controls.getObject().position.y - playerHeight / 3) {
            controls.getObject().position.y = intersections[0].point.y + (playerHeight / 3) * 2;
        }

        for ( let i = 0; i < intersections.length; i++ ) {
            if ( intersections[i]?.object?.grabNodeData?.levelNodeStatic?.material == 2) {
                canJump = false;
                speed *= 1.5;
            }
            if ( intersections[i]?.object?.grabNodeData?.levelNodeFinish && !isLoading ) {
                isLoading = true;
                loadRandomLevel();
            }
            if ( intersections[i]?.object?.grabNodeData?.levelNodeStatic?.material == 3 ) {
                camera.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
            }
        }

    }

    direction.z = Number( moveForward ) - Number( moveBackward );
    direction.x = Number( moveRight ) - Number( moveLeft );
    direction.normalize();

    if ( moveForward || moveBackward ) velocity.z -= direction.z * speed * delta;
    if ( moveLeft || moveRight ) velocity.x -= direction.x * speed * delta;

    controls.moveRight( - velocity.x * delta );
    controls.moveForward( - velocity.z * delta );

    controls.getObject().position.y += ( velocity.y * delta );

    // move player towards grappleTarget
    if (grappleTarget) {
        console.log(controls);
        let direction = new THREE.Vector3();
        direction.subVectors(grappleTarget, controls.getObject().position);
        direction.normalize();
        camera.position.add(direction.multiplyScalar(30 * delta));
        velocity.y = Math.max(0, velocity.y);
    }

    for(let object of animatedObjects) {
        updateObjectAnimation(object, delta);
    }

	renderer.render( scene, camera );
}

function handleKey(event) {
    switch ( event.code ) {
        case 'ArrowUp':
        case 'KeyW':
            moveForward = true;
            break;

        case 'ArrowLeft':
        case 'KeyA':
            moveLeft = true;
            break;

        case 'ArrowDown':
        case 'KeyS':
            moveBackward = true;
            break;

        case 'ArrowRight':
        case 'KeyD':
            moveRight = true;
            break;

        case 'Space':
            if ( canJump === true ) {
                velocity.y += 8;
                if ( event.shiftKey ) velocity.y += 8;
            }
            canJump = false;
            break;

        case 'KeyR':
            loadRandomLevel();
            break;
    }
}

function handleKeyUp(event) {
    switch ( event.code ) {
        case 'ArrowUp':
        case 'KeyW':
            moveForward = false;
            break;

        case 'ArrowLeft':
        case 'KeyA':
            moveLeft = false;
            break;

        case 'ArrowDown':
        case 'KeyS':
            moveBackward = false;
            break;

        case 'ArrowRight':
        case 'KeyD':
            moveRight = false;
            break;
    }
}

function onWindowClick(event) {
    if ( controls.isLocked === true ) {
        
        let ray = new THREE.Raycaster(camera.position, camera.getWorldDirection(new THREE.Vector3()));

        let intersects = ray.intersectObjects(objects, false);

        if (intersects.length > 0) {
            for (let i in intersects) {
                if ([5, 6].includes(intersects[i]?.object?.grabNodeData?.levelNodeStatic?.material)) {
                    grappleTarget = intersects[i].point;
                    console.log(grappleTarget);
                    break;
                }
            }
        }
    } else {
        if (event.target.tagName === "CANVAS") {
            controls.lock();
        }
    }
}

function onWindowRelease() {
    grappleTarget = undefined;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    
    renderer.setSize( window.innerWidth, window.innerHeight );
}

init();