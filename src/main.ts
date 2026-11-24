import './style.css';
import './ui/phone.css';
import { Vector2, Vector3 } from 'three';
import { GameAudio } from './audio/index.ts';
import { createInputState, Keyboard, type Bindings } from './core/input.ts';
import { Gamepads, type PadKind } from './core/gamepad.ts';
import { startLoop } from './core/loop.ts';
import { PointerOrbit } from './core/pointerOrbit.ts';
import { bestCombo, submitCombo } from './core/bests.ts';
import { boardGear, customId, EDIT_PALETTE, gearBoard, graphicFromText, loadCustomSkis, lookSkisText, paintedSlots, setCustomSkisText, type Gear } from './core/customSkis.ts';
import { WEAR_TRIMS, wearSize } from './render/wearPanels.ts';
import { loadCustomWear, paintedWear, setWearText, wearFromText, wearJson, wearPattern, wornOutfit } from './core/customWear.ts';
import { BOARD_TYPES, mainColor, type BoardId } from './core/boards.ts';
import { CUSTOM_PATTERNS, GARMENTS, HEADWEAR, loadOutfit, outfitFrom, PALETTE, PATTERNS, saveOutfit, type Garment, type Outfit } from './core/outfit.ts';
import { SKI_TYPES, type SkiId } from './core/skis.ts';
import {
  clampRung,
  decorDensity,
  loadSettings,
  pixelRatioFor,
  qualityLevel,
  sameLevel,
  saveSettings,
  snowBudget,
  urlQuality,
  viewRange,
  wantsAntialias,
  type CameraView,
  type Quality,
  type QualityLevel,
} from './core/settings.ts';
import { clearStored, readStored, writeStored } from './core/storage.ts';
import { loadWeather, saveWeather, urlWeather, type WeatherId } from './core/weather.ts';
import { buildMap, type BuiltMap } from './maps/build.ts';
import { parseMap } from './maps/loader.ts';
import { mapEntry, MAPS, type MapEntry, type MapId } from './maps/registry.ts';
import type { RailShape } from './maps/types.ts';
import { CONFIG } from './config.ts';
import { ChaseCamera, type OrbitDrag } from './render/chaseCamera.ts';
import { GameCamera } from './render/firstPerson.ts';
import { clothTime } from './render/cloth.ts';
import { LockerStage, present, type Rect, type StageWindow } from './render/lockerStage.ts';
import { AutoQuality } from './render/autoQuality.ts';
import { applyMap, applyWeather, compileShaders, createView, renderFrame, setPixelRatio, setViewRange, type View } from './render/scene.ts';
import { createSkierPose, interpolateSkier, SkierView } from './render/skierView.ts';
import { SnowFx } from './render/snowFx.ts';
import { weatherLook, weatherRange } from './render/weather.ts';
import { WorldView } from './render/world.ts';
import { loadPropModels, needsPropModels } from './render/propModels.ts';
import {
  canSetPersonal,
  createRun,
  resetRun,
  respawnSkier,
  setPersonal,
  updateRun,
  type RunState,
} from './sim/checkpoints.ts';
import { createRace, resetRace, stepRace, type CourseDef, type RaceState } from './sim/race.ts';
import { createScore, endCombo, resetScore, stepScore, taintCombo } from './sim/score.ts';
import { placeInAvalanches, stepAvalanches } from './sim/avalanche.ts';
import { copySkierState, createSkierState, knockDown, placeSkierAt, stepSkier } from './sim/skier.ts';
import { heightAt } from './sim/terrain.ts';
import { anyCheat, CHEATS, configChanged, rebuildTuning, RIDE, setCheat, setRide, setSkiScale, TUNING } from './sim/tuning.ts';
import { CheatsScreen } from './ui/cheatsMenu.ts';
import type { TuningPanel } from './ui/tuningPanel.ts';
import { mountWindowButtons } from './ui/embed.ts';
import { Fader } from './ui/fade.ts';
import { mountFpsMeter } from './ui/fps.ts';
import { mountCrashHint, mountFocusHint } from './ui/hints.ts';
import { ControlsScreen } from './ui/controlsMenu.ts';
import { KeyTesterScreen } from './ui/keyTester.ts';
import { INPUT_LOOK, mainInput, mainKey, mainPad } from './ui/keyNames.ts';
import { PadNav } from './ui/padNav.ts';
import { PadTesterScreen } from './ui/padTester.ts';
import { LockerScreen, setPreviewControl, type ShareKind } from './ui/lockerMenu.ts';
import { marketDescribe, marketThumb, outfitShare, slotShare, useItem } from './ui/marketGlue.ts';
import { isDevName } from './core/devUnlock.ts';
import type { Online } from './online/index.ts';
import type { Dev } from './ui/devPowers.ts';
import type { Multiplayer } from './multiplayer/index.ts';
import { SkiEditorScreen } from './ui/skiEditor.ts';
import { WearEditorScreen } from './ui/wearEditor.ts';
import { PauseScreen, TitleScreen } from './ui/mainMenus.ts';
import { refreshHints } from './ui/menus.ts';
import { MapSelect } from './ui/mapSelect.ts';
import { addBackButton, board, Menus, type Screen } from './ui/menus.ts';
import { SettingsScreen } from './ui/settingsMenu.ts';
import { titleArt } from './ui/titleArt.ts';
import { formatTime, missedText, RaceHud } from './ui/raceHud.ts';
import { RunHud } from './ui/runHud.ts';
import { ScoreHud } from './ui/scoreHud.ts';
import { Toast } from './ui/toast.ts';
import { isTouchScreen } from './ui/phone.ts';
import { registerOffline } from './core/offline.ts';
import { CORNER_RIDERS, CornerMap, SPOT_STRIDE } from './ui/cornerMap.ts';
import { drawMapArt, TrailMap, type MapArt } from './ui/trailMap.ts';

const app = byId('app');
const hud = byId('hud');
const settings = loadSettings();
// The custom slots first, so the outfit can wear a custom ski or board graphic, or a painted jacket or pants.
loadCustomSkis();
loadCustomWear();
/** The skier's look from the Locker. */
let outfit: Outfit = wornOutfit(loadOutfit());
setSkiScale(CONFIG.skis[outfit.ski]);
// Skis or the snowboard, as the Locker saved it (milestone 22). For testing,
// ?board=regular or ?board=goofy rides the saved board this visit, and
// ?board=skis rides skis; not saved unless the Locker then changes something.
const urlBoard = new URLSearchParams(window.location.search).get('board');
if (urlBoard === 'regular' || urlBoard === 'goofy' || urlBoard === '1') outfit = { ...outfit, ride: 'board', stance: urlBoard === 'goofy' ? 'goofy' : 'regular' };
else if (urlBoard === 'skis' || urlBoard === '0') outfit = { ...outfit, ride: 'skis' };
setRide(outfit.ride === 'board', outfit.stance === 'goofy', outfit.board);
/** The preset in use: the saved one, unless the URL names one for this visit. */
let quality: Quality = urlQuality() ?? settings.quality;
/** Auto's rung: one better than where it settled last visit (skipping rungs that draw the same here), stepping down while riding if frames are slow. */
const auto = new AutoQuality(tryBetter(settings.autoRung));
/** What the quality setting draws now (Auto's depends on its rung), and what the world was last built for. */
let drawn: QualityLevel = currentLevel();
/** The weather, the same on every map: the saved pick, unless the URL names one for this visit. */
let weather: WeatherId = urlWeather() ?? loadWeather();

let view: View;
try {
  view = createView(app, wantsAntialias(quality), pixelRatioFor(drawn));
} catch (err) {
  console.error(err);
  showFatal('This game needs WebGL, which this browser could not start. Try updating Chrome or turning on hardware acceleration.');
  throw err;
}
const { renderer, scene, camera } = view;
/**
 * True once the graphics stop (the WebGL context was lost: a GPU reset, or
 * a computer short of memory). Nothing can be drawn after that, so the game
 * waits behind a message with a Reload button (settings are saved).
 */
let graphicsLost = false;
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  if (graphicsLost) return;
  graphicsLost = true;
  keyboard.setEnabled(false);
  showFatal('The graphics stopped (the computer may be short of memory). Reload to keep riding; your settings are kept.', 'Reload', () => window.location.reload());
});

const windowBar = mountWindowButtons(hud);
mountFocusHint(hud);
// A phone or the installed game keeps a copy of the build for playing offline (core/offline.ts).
registerOffline();
const fps = mountFpsMeter(hud);
const crashHint = mountCrashHint(hud);
const fader = new Fader(hud);
const toast = new Toast(hud);
const cheatsTag = mountCheatsTag(hud);
const raceHud = new RaceHud(hud);
const runHud = new RunHud(hud, backToTop);
/** Sound (src/audio): nothing is made or heard until the first key press or click. */
const sound = new GameAudio(settings.masterVolume, settings.sfxVolume, settings.muted);
sound.setPoles(outfit.poles);
sound.attach(window, hud);
sound.setWeather(weather);
const scoreHud = new ScoreHud(
  hud,
  (total, tainted) => {
    // Ridden with cheats on: it can only be the map's cheats best, never its clean one.
    const note = !level ? 'banked' : tainted ? (submitCombo(level.id, total, true) ? 'cheatsBest' : 'cheats') : submitCombo(level.id, total) ? 'best' : 'banked';
    sound.combo(note === 'best' || note === 'cheatsBest' ? 'best' : 'bank');
    // A new personal best goes on the map's online board too.
    if (level && (note === 'best' || note === 'cheatsBest')) postScore(level.id, -1, note === 'cheatsBest', total);
    // Multiplayer (milestone 27): the lobby hears the best combo this visit and the last trick.
    mp?.banked(total, scoreHud.lastTrick);
    return note;
  },
  () => sound.combo('lost'),
);
const trailMap = new TrailMap(hud, closeTrailMap);
/** The small trail map in the HUD's corner (milestone 21): the trail-map key shows and hides it, and the game keeps running. */
const cornerMap = new CornerMap(hud);
cornerMap.setShown(settings.cornerMap);
const keyboard = new Keyboard(settings.bindings, settings.padBindings);
keyboard.setPopWithUp(settings.popWith === 'up');
keyboard.attach(window);
/** Controllers (milestone 26): read once a frame (the loop's poll), into the same actions as the keys. */
const pads = new Gamepads();
/** Settings listening for a new button: every pad press and release goes there and nowhere else. */
let padListen: ((code: string, down: boolean) => void) | null = null;
/** Whether the note that sound needs a key or a click has been shown this visit. */
let soundNoteShown = false;
// A real key press: hints name keys again.
window.addEventListener(
  'keydown',
  (e) => {
    if (e.isTrusted) setInputLook(false, INPUT_LOOK.kind);
  },
  true,
);
pads.onUse = (kind) => setInputLook(true, kind);
pads.onConnect = () => {
  if (padTester.isShown) padTester.sync();
};
pads.sink = (code, down) => {
  if (padListen) {
    padListen(code, down);
    return;
  }
  if (!gameWaits()) {
    // Riding: the pad is the keyboard (and for the developer, the powers' buttons).
    keyboard.padKey(code, down);
    if (devLive()) dev?.padKey(code, down);
    if (down && keyboard.isPadBound('pause', code)) openPause();
    return;
  }
  if (padTester.isShown && menus.top === padTester) {
    padTester.button(code, down);
    return;
  }
  // The full trail map: its own button closes it, as B does.
  if (down && trailMap.isOpen && !menus.isOpen && keyboard.isPadBound('trailMap', code)) {
    closeTrailMap();
    return;
  }
  padNav.button(code, down);
};

// The menus: the title before any map is loaded, the pause menu while riding,
// and the screens they open. The game waits while any is open.
const menus = new Menus(hud, onRootBack, onGameKey, () => [...windowBar.querySelectorAll<HTMLElement>('a, button')]);
menus.scenery.innerHTML = titleArt();
/** Whether the board name is the developer's nickname (core/devUnlock.ts): with a saved code, the marketplace's Remove shows. */
let devName = false;
void isDevName(settings.name).then((d) => {
  devName = d;
  checkDev();
});
const titleScreen = new TitleScreen({
  play: openMapSelect,
  locker: openLocker,
  settings: openSettings,
  cheats: openCheats,
  leaderboards: () => openBoards((mapEntry(readStored('map'))?.id ?? MAPS[0]!.id) as MapId),
  name: () => settings.name,
  setName: (name) => {
    settings.name = name;
    saveSettings(settings);
  },
  nameDone: nameChosen,
  isDev: (name) =>
    isDevName(name).then((d) => {
      if (name === settings.name) {
        devName = d;
        checkDev();
      }
      return d;
    }),
  devCode: () => settings.devCode,
  setDevCode: (code) => {
    settings.devCode = code;
    saveSettings(settings);
  },
  checkDevCode: (code) =>
    loadOnline()
      .then((o) => o.checkCode(code), () => 'offline' as const)
      .then((r) => {
        devAnswer(code, r);
        return r;
      }),
});
const pauseScreen = new PauseScreen({
  resume: closeMenus,
  respawn: () => {
    closeMenus();
    respawn();
  },
  backToTop: () => {
    closeMenus();
    backToTop();
  },
  trailMap: () => openTrailMap(true),
  lobby: () => mp?.openRoom(),
  maps: openMapSelect,
  locker: openLocker,
  settings: openSettings,
  cheats: openCheats,
  mainMenu: toMainMenu,
  leaderboards: () => {
    if (level) openBoards(level.id, level.race && level.race.course >= 0 ? level.race.course : -1);
  },
  weather: () => weather,
  setWeather,
});
const mapSelect = new MapSelect((entry) => void loadMap(entry), () => menus.back(), { get: () => weather, set: setWeather }, (id) => openBoards(id));
mapSelect.onLobbies = (entry) => openLobbies(entry.id);
mapSelect.onAllLobbies = () => openLobbies('');
/** A map's lobby list (and the other maps' open lobbies), or with '' every map's. */
function openLobbies(map: string): void {
  loadMultiplayer().then(
    (m) => m.openLobbies(map),
    () => mapSelect.setError("Couldn't load multiplayer. Check the connection and try again, or ride alone."),
  );
}
const settingsScreen = new SettingsScreen(
  {
    get: () => ({ ...settings, quality }),
    setQuality,
    autoNow: () => levelName(qualityLevel('auto', auto.rung)),
    antialiased: () => renderer.getContextAttributes()?.antialias === true,
    setSound: (master, sfx, muted) => {
      settings.masterVolume = master;
      settings.sfxVolume = sfx;
      settings.muted = muted;
      saveSettings(settings);
      sound.setVolume(master, sfx, muted);
    },
    previewSound: (master, sfx, muted) => sound.setVolume(master, sfx, muted),
    setScore: (on) => {
      settings.score = on;
      saveSettings(settings);
      if (!on) resetScore(score);
    },
    setCrashWait: (wait) => {
      settings.crashWait = wait;
      saveSettings(settings);
      syncKeyLabels();
    },
    setPopWith: (key) => {
      settings.popWith = key;
      keyboard.setPopWithUp(key === 'up');
      saveSettings(settings);
    },
    setCamera: (v) => setCameraView(v, false),
    setFirstAir: (air) => {
      settings.firstAir = air;
      gameCamera.firstAir = air;
      saveSettings(settings);
    },
    setBindings,
    setPadBindings: (b) => {
      settings.padBindings = b;
      keyboard.setPadBindings(b);
      saveSettings(settings);
      syncKeyLabels();
    },
    listenPad: (fn) => {
      padListen = fn;
      padNav.reset();
    },
    openControls,
    trapNextKey: (fn) => menus.trapNextKey(fn),
    wipeLocal: () => {
      clearStored();
      // Start again from nothing: nothing in memory gets a chance to save itself back.
      window.location.reload();
    },
  },
  () => menus.back(),
);
const keyTester = new KeyTesterScreen(() => settings.bindings, () => menus.back());
const padTester = new PadTesterScreen(pads, () => settings.padBindings, () => menus.back());
const controlsScreen = new ControlsScreen(
  () => settings,
  () => menus.push(keyTester),
  () => menus.push(padTester),
  () => menus.back(),
);
/** Menus by pad (milestone 26): the d-pad and left stick move, A picks, B goes back. */
const padNav = new PadNav(menus);
const cheatsScreen = new CheatsScreen(
  {
    isOn: (id) => CHEATS[id],
    set: (id, on) => {
      setCheat(id, on);
      syncCheatsTag();
    },
    panelOpen: () => tuningPanel?.isOpen ?? false,
    togglePanel: async () => {
      if (tuningPanel?.isOpen) tuningPanel.close();
      else (await loadTuningPanel()).open();
    },
  },
  () => menus.back(),
);
// The Locker and the ski editor: the preview is drawn, then copied into the screen's window, while either is open (see drawLocker).
const lockerStage = new LockerStage(outfit);
lockerStage.setRide(RIDE.board, RIDE.goofy);
/** The screen whose window shows the preview, or null. */
let stageScreen: StageWindow | null = null;
/** A custom ski or board was painted: rebuild the skis (or the board) on the next preview frame. */
let skisDirty = false;
/** A custom jacket or pants was painted (milestone 23 part 2): rebuild that garment on the next preview frame. */
const wearDirty = new Set<Garment>();
function showStage(screen: StageWindow | null): void {
  // A window opening starts turning by itself, untilted and unzoomed.
  if (screen && screen !== stageScreen) lockerStage.resetHand();
  stageScreen = screen;
  // The painted mountain fills round the window, from the title and from pause.
  menus.setScenery(screen !== null || !level);
  if (!screen) {
    repaintSkis();
    // The ski editor opening over the Locker shows the stage again at once: only leaving both saves.
    queueMicrotask(() => {
      if (!stageScreen) saveLookOnline(false);
    });
  }
}
// A drag or the wheel on any preview window moves the stage's camera by hand.
setPreviewControl({
  grab: () => lockerStage.handGrab(),
  drag: (dx, dy) => lockerStage.handDrag(dx, dy),
  release: () => lockerStage.handRelease(),
  zoom: (deltaY) => lockerStage.handZoom(deltaY),
});
const lockerScreen = new LockerScreen(
  {
    get: () => outfit,
    set: setOutfit,
    skisShown: (on) => lockerStage.showSkis(on),
    shown: (open) => showStage(open ? lockerScreen : null),
    edit: (gear, slot) => {
      skiEditor.open(gear, slot);
      menus.push(skiEditor);
    },
    editWear: (garment, slot) => {
      wearEditor.open(garment, slot);
      menus.push(wearEditor);
    },
    market: showMarket,
    share: shareSlot,
  },
  () => menus.back(),
);
const skiEditor = new SkiEditorScreen(
  {
    wear: (gear, graphic) => {
      const board = gearBoard(gear);
      setOutfit(board ? { ...outfit, ride: 'board', board, boardGraphic: graphic } : { ...outfit, ride: 'skis', ski: gear as SkiId, skiGraphic: graphic });
    },
    repaint: () => (skisDirty = true),
    shown: (open) => {
      if (open) lockerStage.showSkis(true);
      showStage(open ? skiEditor : null);
    },
    share: (gear, slot) => shareSlot(gearBoard(gear) ? 'board' : 'skis', gear, slot),
  },
  () => menus.back(),
);
const wearEditor = new WearEditorScreen(
  {
    get: () => outfit,
    wear: (garment, slot) => {
      const g = GARMENTS.find((x) => x.id === garment)!;
      // The same slot worn already: its squares may have just been made, so rebuild it.
      if (outfit[g.pattern] === wearPattern(slot)) wearDirty.add(garment);
      setOutfit({ ...outfit, [g.pattern]: wearPattern(slot) });
    },
    repaint: (garment) => wearDirty.add(garment),
    shown: (open) => {
      if (open) lockerStage.showSkis(false);
      showStage(open ? wearEditor : null);
    },
    share: (garment, slot) => shareSlot(garment, garment, slot),
  },
  () => menus.back(),
);
for (const screen of [titleScreen, pauseScreen, mapSelect, settingsScreen, controlsScreen, keyTester, padTester, cheatsScreen, lockerScreen, skiEditor, wearEditor]) menus.add(screen);

// The online leaderboards (src/online, its own chunk): imported the first
// time a board opens or a score posts, never at startup. Blocked or offline,
// the boards say so and nothing else changes.
let online: Online | null = null;
let onlineLoading: Promise<Online> | null = null;
/** When this run began (back to the top, or a timed run restarted): the finish board shows only this run's post. */
let runSince = 0;
/** True when cheats were on at any moment of the timed run (its time goes on the course's Cheats board). */
let raceCheats = false;
/** True when the timed run was flown in at any moment (milestone 25, the developer's powers): its time posts nowhere. */
let raceFlown = false;

// The developer's powers (milestone 25): their chunk (ui/devPowers.ts) is
// imported only once the board name is the developer's (core/devUnlock.ts)
// and the Worker has accepted the saved code this visit. Everyone else's
// game never fetches it, so nothing of it runs or shows for them.
/** The powers' chunk, once loaded; null for everyone else. */
let dev: Dev | null = null;
let devLoading: Promise<void> | null = null;
/** The Worker accepted the saved code, and which code it last answered for (checked once a visit, and again when the title's box changes it). */
let devAccepted = false;
let devChecked: string | null = null;

/** True while the powers work: the board name is the developer's and the Worker accepted the code. */
function devLive(): boolean {
  return dev !== null && devName && devAccepted;
}

/** Asks the Worker whether the saved code is right, once a visit (only for the developer's name); a yes loads the powers. */
function checkDev(): void {
  const code = settings.devCode;
  if (!devName || !code || devChecked === code) return;
  devChecked = code;
  loadOnline()
    .then((o) => o.checkCode(code))
    .then(
      (r) => devAnswer(code, r),
      () => {},
    );
}

/** The Worker's answer for `code`: right loads the powers; wrong or offline turns them off. */
function devAnswer(code: string, answer: 'ok' | 'wrong' | 'offline'): void {
  if (code !== settings.devCode) return;
  devChecked = code;
  devAccepted = answer === 'ok';
  if (!devAccepted) return;
  devLoading ??= import('./ui/devPowers.ts').then(
    (m) => {
      dev = m.createDevPowers({ hud, scene, audio: sound.engine, listening: () => !gameWaits() });
      // Multiplayer (milestone 27): the other riders in a lobby are a target too; a hit crashes them in their game.
      dev.powers.riderShot = (from, dir, range) => (mp && devLive() ? mp.shoot(from, dir, range) : -1);
      controlsScreen.extra = () => (devLive() && dev ? dev.controls() : null);
      keyTester.extraKeys = () => (devLive() && dev ? dev.testerKeys : null);
      padTester.extraPad = () => (devLive() && dev ? dev.testerPads : null);
    },
    () => {
      devLoading = null;
    },
  );
}
// Multiplayer (milestone 27): its chunk (multiplayer/index.ts) is imported
// only when a player turns "Ride with others" on and picks a map. Riding
// alone never fetches it; blocked or offline, the game goes on alone.
let mp: Multiplayer | null = null;
let mpLoading: Promise<Multiplayer> | null = null;

function loadMultiplayer(): Promise<Multiplayer> {
  mpLoading ??= import('./multiplayer/index.ts').then(({ createMultiplayer }) => {
    mp = createMultiplayer({
      scene,
      hud,
      push: (screen) => menus.push(screen),
      back: () => menus.back(),
      name: () => settings.name,
      outfitJson: () => JSON.stringify(outfit),
      // Dev builds' play-tests may give the local Worker's throwaway code (?mpdev=); production strips it, and the Worker checks the code either way.
      devCode: () => (devLive() ? settings.devCode : import.meta.env.DEV ? new URLSearchParams(window.location.search).get('mpdev') : null),
      mapName: (id) => mapEntry(id)?.name ?? id,
      currentMap: () => level?.id ?? null,
      loadMap: async (id) => {
        const entry = mapEntry(id);
        if (!entry?.load) return false;
        await loadMap(entry);
        return level?.id === id;
      },
      hf: () => level?.built.hf ?? null,
      detail: () => drawn.detail,
      ridingKeys: (on) => keyboard.setEnabled(on && !menus.isOpen && !trailMap.isOpen),
      inLobby: (on) => pauseScreen.setLobby(on),
      toast: (text) => toast.show(text),
      chatKey: () => mainKey(settings.bindings, 'chat'),
      paint: { customId, boardGear, graphicFromText, wearFromText, hexes: EDIT_PALETTE.map((c) => c.hex) },
    });
    for (const screen of mp.screens) menus.add(screen);
    return mp;
  });
  // A failed load can be tried again.
  mpLoading.catch(() => (mpLoading = null));
  return mpLoading;
}

/** Whether the finish being shown has had its board opened (see the frame), and whether the player hid it. */
let finishSeen = false;
let boardHidden = false;
/** Shown instead of the Leaderboards screen if its chunk can't be fetched. */
let offlineScreen: Screen | null = null;

function loadOnline(): Promise<Online> {
  onlineLoading ??= import('./online/index.ts').then(
    ({ createOnline }) => {
      const o = createOnline({
        myName: () => settings.name,
        outfit: () => outfit,
        lookTables: {
          palette: PALETTE.map((c) => c.hex),
          headwear: HEADWEAR.map((h) => h.id),
          // The stock patterns, then the painted slots (milestone 23 part 2: digits 4 to 6, which an older game draws plain).
          patterns: [...PATTERNS.map((x) => x.id), ...CUSTOM_PATTERNS],
          skis: SKI_TYPES.map((x) => x.id),
          boards: BOARD_TYPES.map((t) => ({ id: t.id, graphics: t.graphics.map((g) => g.id), colors: t.graphics.map((g) => mainColor(t, g)) })),
        },
        finishSlot: runHud.boardSlot,
        back: () => menus.back(),
        closeFinish: () => {
          boardHidden = true;
          o.finish.hide();
        },
        push: (screen) => menus.push(screen),
        market: {
          thumb: marketThumb,
          describe: marketDescribe,
          use: (item, pick) =>
            useItem(item, pick, {
              outfit: () => outfit,
              setOutfit,
              skisChanged: () => (skisDirty = true),
              wearChanged: (garment) => wearDirty.add(garment),
              slotsChanged: () => {
                repaintSkis();
                lockerScreen.refresh();
              },
            }),
          shareOutfit: () => o.openShare({ ...outfitShare(outfit), look: o.lookCode(outfit) }),
          devCode: () => (devName ? settings.devCode : ''),
        },
      });
      o.finish.setKey(mainInput(settings.bindings, settings.padBindings, 'board'));
      menus.add(o.screen);
      menus.add(o.lookPrompt);
      menus.add(o.shareSign);
      menus.add(o.slotPicker);
      online = o;
      return o;
    },
    (err: unknown) => {
      onlineLoading = null;
      throw err;
    },
  );
  return onlineLoading;
}

// Dev builds only: the marketplace's copies of the grid sizes (src/online/marketRules.ts, shared with the Worker) still match the game's.
if (import.meta.env.DEV) {
  void import('./online/marketRules.ts').then((r) => {
    const wrong: string[] = [];
    for (const t of SKI_TYPES) if (String(r.SKI_GRIDS[t.id]) !== String([t.model.rows, t.model.cols])) wrong.push(`ski ${t.id}`);
    for (const t of BOARD_TYPES) if (String(r.BOARD_GRIDS[t.id]) !== String([t.model.rows, t.model.cols])) wrong.push(`board ${t.id}`);
    for (const g of ['jacket', 'pants'] as const) {
      if (r.WEAR_SQUARES[g] !== wearSize(g)) wrong.push(`${g} squares`);
      if (r.WEAR_TRIM_COUNT[g] !== WEAR_TRIMS[g]) wrong.push(`${g} trims`);
    }
    if (r.PALETTE_SIZE !== EDIT_PALETTE.length) wrong.push('palette');
    if (wrong.length) console.error(`marketRules.ts is out of date: ${wrong.join(', ')}`);
  });
}

/** The Leaderboards screen, on a map's board (on the Slalom, a course's). */
function openBoards(map: MapId, course = -1): void {
  const cheats = !cheatsTag.hidden;
  loadOnline().then(
    (o) => {
      if (!menus.isOpen || menus.top === o.screen) return;
      o.screen.show(o.ref(map, course, cheats));
      menus.push(o.screen);
    },
    () => {
      if (!menus.isOpen) return;
      offlineScreen ??= offlineBoards();
      menus.push(offlineScreen);
    },
  );
}

function offlineBoards(): Screen {
  return offlineSign('Leaderboards', 'leaderboards-screen', 'Leaderboard offline. Your bests still save on this computer.');
}

/** A sign that only says the online part can't be reached (its chunk didn't load), with Back. */
function offlineSign(heading: string, className: string, text: string): Screen {
  const b = board(heading, className);
  addBackButton(b.head, () => menus.back());
  const status = document.createElement('p');
  status.className = 'board-status';
  status.textContent = text;
  b.body.appendChild(status);
  const screen: Screen = { el: b.el, enter: () => null };
  menus.add(screen);
  return screen;
}

// The marketplace (milestone 24): its panel, signs and API live in the
// online chunk, fetched the first time the Locker's Market tab opens or
// something is shared; main draws the thumbnails and does Use and the
// sharing's reading of slots (ui/marketGlue.ts).
/** The Market tab's panel while it shows. */
let marketShown: HTMLElement | null = null;
/** Shown instead of the Share sign if the online chunk can't be fetched. */
let shareOffline: Screen | null = null;
const MARKET_OFFLINE = 'Marketplace offline. Your designs still save on this computer.';

function showMarket(panel: HTMLElement | null): void {
  marketShown = panel;
  if (!panel) {
    online?.market.unmount();
    return;
  }
  loadOnline().then(
    (o) => {
      if (marketShown === panel) o.market.mount(panel);
    },
    () => {
      if (marketShown !== panel) return;
      const note = document.createElement('p');
      note.className = 'setting-note';
      note.textContent = MARKET_OFFLINE;
      panel.replaceChildren(note);
    },
  );
}

/** Share a painted slot (from the Locker or an editor): the Share sign, or a note that the marketplace is offline. */
function shareSlot(kind: ShareKind, gear: Gear | Garment, slot: number): void {
  const request = slotShare(kind, gear, slot);
  if (!request) return;
  loadOnline().then(
    (o) => o.openShare(request),
    () => {
      shareOffline ??= offlineSign('Share', 'share-sign', MARKET_OFFLINE);
      menus.push(shareOffline);
    },
  );
}

/** Posts a new best combo (course -1) or a clean course time (ms) to its online board, if the player has a name. */
function postScore(map: MapId, course: number, cheats: boolean, value: number): void {
  if (!settings.name) return;
  loadOnline().then(
    (o) => o.post(o.ref(map, course, cheats), value),
    () => {},
  );
}

/** At the finish: the map's board beside "Finished!" (on the Slalom, the timed course's; none after an untimed run). */
function showFinishBoard(): void {
  if (!level || boardHidden) return;
  const { id, race, built } = level;
  const timed = race?.finished === true;
  if (built.map.scoring === false && !timed) return;
  const course = timed && race ? race.course : -1;
  const cheats = timed ? raceCheats : !cheatsTag.hidden;
  const note = timed && race && race.missed > 0 ? 'Missed a gate: not posted.' : timed && raceFlown ? 'Flown: not posted.' : '';
  const since = runSince;
  loadOnline().then(
    (o) => {
      if (level?.run.finished && !boardHidden) o.finish.show({ ref: o.ref(id, course, cheats), since, note });
    },
    () => {},
  );
}

// The look saved online under the board name (src/online/looks.ts): the
// outfit and every custom ski, always saved on this computer first. A new
// name entered on the title brings up the look saved under it, if any, to
// load or not; with none there yet, this computer's look is saved under it.
// After that, closing the Locker saves the look online when it changed.
/** The name this visit last loaded, saved or asked about a look for (the name already set at startup counts). */
let lookName = settings.name;
/** The look as last loaded or saved online (outfit and custom skis), so only a change is saved. */
let lookSaved = lookText();

function lookText(): string {
  return `${JSON.stringify(outfit)}\n${lookGearText()}`;
}

/** An online look's `skis` text: the custom skis and boards, and (milestone 23 part 2) the painted garments as `wear`. */
function lookGearText(): string {
  return lookSkisText({ wear: wearJson() });
}

/** The title's name box was finished with `name` saved: offer the look saved online under it. */
function nameChosen(name: string): void {
  if (!name || name === lookName) return;
  lookName = name;
  loadOnline()
    .then((o) => o.fetchLook(name).then((found) => ({ o, found })))
    .then(
      ({ o, found }) => {
        if (settings.name !== name) return;
        if (!found) {
          saveLookOnline(true);
          return;
        }
        // Only over the title: anywhere else the player has moved on.
        if (menus.top !== titleScreen) return;
        o.lookPrompt.ask(found.name, o.lookCode(outfitFrom(found.outfit)), paintedSlots(found.skis) + paintedWear(found.skis), () => {
          // Custom skis and garments first, so the outfit can wear them.
          setCustomSkisText(found.skis);
          setWearText(found.skis);
          setOutfit(wornOutfit(outfitFrom(found.outfit)));
          skisDirty = true;
          wearDirty.add('jacket').add('pants');
          repaintSkis();
          lookSaved = lookText();
          menus.back();
        }, () => menus.back());
        menus.push(o.lookPrompt);
      },
      () => {},
    );
}

/** Saves the look online under the board name (when it changed since the last load or save, unless `always`). */
function saveLookOnline(always: boolean): void {
  const name = settings.name;
  const text = lookText();
  if (!name || (!always && text === lookSaved)) return;
  lookSaved = text;
  loadOnline()
    .then((o) => o.saveLook({ name, outfit: JSON.stringify(outfit), skis: lookGearText() }))
    .catch(() => {
      // Offline: try again the next time the Locker closes.
      lookSaved = '';
    });
}

/** The board key at the finish: hides the board, or shows it again. */
function toggleFinishBoard(): void {
  if (online?.finish.shown) {
    boardHidden = true;
    online.finish.hide();
  } else {
    boardHidden = false;
    showFinishBoard();
  }
}

// HUD buttons for the mouse, beside the window buttons; hidden while a menu is open.
/** Under a finished timed run's result: the respawn key races the course again. */
let raceAgainHint = '';
const pauseButton = hudButton('Pause', openPause);
// The full trail map (the trail-map key only shows and hides the corner map now, so the button names no key).
const trailButton = hudButton('Trail map', () => openTrailMap());
trailButton.textContent = 'Trail map';
windowBar.prepend(trailButton, pauseButton);
syncKeyLabels();

// Simulation state: the current step and the one before it, for interpolation.
const keys = createInputState();
const skier = createSkierState();
const skierPrev = createSkierState();
/** Combo scoring (sim/score.ts), stepped after the skier on maps that score. */
const score = createScore();
/** Seconds R has been held; past CONFIG.checkpoints.holdToTop it goes back to the top, once per hold. */
let holdTime = 0;
let heldToTop = false;

/** The map being ridden: built for the sim, drawn, and the run on it. */
interface Level {
  id: MapId;
  built: BuiltMap;
  world: WorldView;
  run: RunState;
  race: RaceState | null;
}
let level: Level | null = null;
/** The map being ridden's trail-map art (drawn behind "Loading"), shared by the full map and the corner map; null until drawn. */
let mapArt: MapArt | null = null;
/** The full trail map was opened from the pause menu, so closing it goes back there. */
let trailFromPause = false;
/** True while a new map's shaders compile (see loadMap): no frame is drawn, so none waits on the compiler. */
let warming = false;
applyView();

// Render state. The skier and camera are made with the first map.
const pose = createSkierPose();
let skierView: SkierView | null = null;
let chase: ChaseCamera | null = null;
/** The chase camera or first person (milestone 18), and the ease between them. */
const gameCamera = new GameCamera(camera);
gameCamera.view = settings.camera;
gameCamera.firstAir = settings.firstAir;
const orbit = new PointerOrbit();
orbit.attach(renderer.domElement);
const drag: OrbitDrag = { x: 0, y: 0, active: false };
let snapView = true;
/** Build the snow's near chunks at once next frame (the view range changed), without snapping the camera. */
let rebuildView = false;
/** Dev only: a fixed camera spot and aim (parkLaps.lookFrom), instead of the chase camera. */
let freeCamera: { from: Vector3; at: Vector3 } | null = null;

/** True from a course's timing wand until back to the start (a timed run, finished or not). */
function timedRun(): boolean {
  return level?.race != null && (level.race.running || level.race.finished);
}

/** The course of the timed run, if on one. */
function timedCourse(): CourseDef | undefined {
  const race = level?.race;
  return race && timedRun() ? level?.built.race?.courses[race.course] : undefined;
}

/** True when combos are scored: on in Settings, on a map that scores (not the Slalom). */
function scoring(): boolean {
  return settings.score && level !== null && level.built.map.scoring !== false;
}

/** Back to the latest checkpoint; on a timed run, back to that course's start house for another go. */
function respawn(): void {
  if (!level) return;
  const { built, run, race } = level;
  // A live combo banks if the skier is riding the snow, and is lost mid-air or on a rail.
  if (scoring()) endCombo(score, skier);
  const start = timedCourse()?.start;
  if (race && start) {
    runSince = performance.now();
    resetRace(race);
    run.finished = false;
    placeSkierAt(skier, start.x, start.z, start.heading, built.hf);
  } else {
    respawnSkier(run, skier, built.map, built.hf);
  }
  copySkierState(skierPrev, skier);
  // Appearing on an avalanche zone isn't riding into it: no roll until the skier leaves it and comes back.
  if (built.course.avalanches) placeInAvalanches(built.course.avalanches, skier);
  snapView = true;
  fader.reveal();
  auto.hold();
}

/** A fresh run from the top: every checkpoint and passed flag is forgotten. */
function backToTop(): void {
  if (!level) return;
  runSince = performance.now();
  resetRun(level.run);
  if (level.race) resetRace(level.race);
  respawn();
}

/** Picks a map: builds it (after letting "Loading" show), drops the old one, and starts at the top. */
async function loadMap(entry: MapEntry): Promise<void> {
  if (!entry.load) return;
  if (level?.id === entry.id) {
    closeMenus();
    return;
  }
  mapSelect.setLoading(entry.id);
  try {
    const map = parseMap(await entry.load());
    // The City's street props come from converted model packs, a chunk of their own fetched only for a map that uses them.
    if (needsPropModels(map)) await loadPropModels();
    await nextPaint();
    // Free the old map before building the new one, to keep peak memory down.
    level?.world.dispose();
    level = null;
    mapArt = null;
    cornerMap.setMap(null);
    sound.setMap(null);
    resetScore(score);
    const built = buildMap(map);
    const world = new WorldView(built, decorDensity(drawn.detail), viewRange(drawn.view).far, snowBudget(drawn.detail));
    scene.add(world.group);
    applyMap(view, built);
    level = { id: entry.id, built, world, run: createRun(map), race: built.race ? createRace(built.race) : null };
    mp?.mapChanged(entry.id);
    sound.setMap(built);
    if (skierView && chase) {
      skierView.hf = built.hf;
      chase.hf = built.hf;
    } else {
      skierView = new SkierView(scene, built.hf, outfit);
      skierView.setRide(RIDE.board, RIDE.goofy);
      chase = new ChaseCamera(camera, built.hf);
    }
    applyWeatherLook();
    writeStored('map', entry.id);
    tuningPanel?.setMap(map);
    backToTop();
    // While "Loading" still shows: build the snow round the start and compile
    // every shader the map draws, so the first frames (and the first spray,
    // night or new corner of the map) don't stall. Nothing is drawn meanwhile.
    world.view(skier.position.x, skier.position.z, camera.far, true);
    warming = true;
    try {
      await Promise.all([world.warm(renderer, camera, scene), compileShaders(renderer, view.backdrop.scene, view.backdrop.camera)]);
    } finally {
      warming = false;
    }
    // The trail map's art (the full map and the corner map), in slices so "Loading" keeps painting; never during a ride.
    const art = await drawMapArt(built, nextTask);
    if (level?.built !== built) return;
    mapArt = art;
    // Only the open maps (Freeride, the City) show the corner map; the lane maps leave the corner clear.
    cornerMap.setMap(entry.cornerMap ? art : null);
    // The first frame also uploads every mesh to the GPU: draw it behind "Loading" too.
    await nextPaint();
    mapSelect.setLoading(null);
    closeMenus();
  } catch (err) {
    console.error(err);
    mapSelect.setError(`Couldn't load ${entry.name}. Try again, or pick another map.`);
  }
}

/** From pause: leaves the map for the title (bests, settings and the look are already saved; a combo on the snow banks). */
function toMainMenu(): void {
  if (!level) return;
  if (scoring()) endCombo(score, skier);
  trailMap.close();
  online?.finish.hide();
  mp?.leave();
  level.world.dispose();
  level = null;
  mapArt = null;
  cornerMap.setMap(null);
  sound.setMap(null);
  resetScore(score);
  openTitle();
}

/** The title, over the painted mountain: where the game starts. */
function openTitle(): void {
  keyboard.setEnabled(false);
  menus.setScenery(true);
  menus.open(titleScreen);
}

/** The pause menu (Esc, the pause key, or the HUD button); the game waits behind it. */
function openPause(): void {
  if (!level) return;
  trailMap.close();
  keyboard.setEnabled(false);
  const b = settings.bindings;
  const resume = INPUT_LOOK.pad ? [mainPad(settings.padBindings, 'pause')] : [mainKey(b, 'pause'), 'Esc'];
  pauseScreen.setInfo(mapEntry(level.id)?.name ?? '', resume, mainInput(b, settings.padBindings, 'respawn'), (code) => keyboard.isBound('pause', code));
  menus.setScenery(false);
  menus.open(pauseScreen);
}

function openMapSelect(): void {
  mapSelect.prepare(level?.id ?? null, (mapEntry(readStored('map'))?.id ?? MAPS[0]!.id) as MapId);
  menus.push(mapSelect);
}

function openSettings(): void {
  menus.push(settingsScreen);
}

function openControls(): void {
  menus.push(controlsScreen);
}

function openCheats(): void {
  menus.push(cheatsScreen);
}

function openLocker(): void {
  menus.push(lockerScreen);
}

/** A new look from the Locker: on the skier at once (and the preview), and saved (unless `save` is false: the dev hook). */
function setOutfit(next: Outfit, save = true): void {
  outfit = next;
  if (save) saveOutfit(outfit);
  setSkiScale(CONFIG.skis[outfit.ski]);
  skierView?.rig.setOutfit(outfit);
  lockerStage.setOutfit(outfit);
  sound.setPoles(outfit.poles);
  // Skis or the board (milestone 22): the sim's multipliers, edges and names, the rig, the stage.
  const board = outfit.ride === 'board';
  const goofy = board && outfit.stance === 'goofy';
  if (board !== RIDE.board || goofy !== RIDE.goofy || (board && outfit.board !== RIDE.type)) {
    // A combo under way ends with what it was ridden on.
    if (scoring()) endCombo(score, skier);
    setRide(board, goofy, outfit.board);
    skierView?.setRide(board, goofy);
    lockerStage.setRide(board, goofy);
  }
}

/**
 * The Locker's preview, instead of the full frame (the painted menu covers
 * the canvas): the paused world round the skier, or the stage before any
 * map, drawn at the canvas's top left at the window's size, then copied into
 * the window's own canvas (present). It turns, and the Santa hat's pom-pom
 * sways, in real time. Nothing is drawn while the window is scrolled out of sight.
 */
function drawLocker(screen: StageWindow, realFrameTime: number): void {
  repaintSkis();
  const at = screen.viewRect();
  const ctx = screen.viewContext();
  lockerStage.turn(realFrameTime);
  clothTime.value += realFrameTime;
  const canvas = renderer.domElement;
  stageRect.width = Math.min(at.width, canvas.clientWidth);
  stageRect.height = Math.min(at.height, canvas.clientHeight);
  if (!ctx || stageRect.width <= 0 || stageRect.height <= 0 || at.y >= window.innerHeight || at.y + at.height <= 0) return;
  // The Locker always shows the whole skier, first person or not (the game camera hides the head again next frame).
  skierView?.rig.setHidden(false, false);
  if (level && skierView) lockerStage.renderWorld(view, stageRect, pose.center, level.built.hf, level.built.course.obstacles);
  else lockerStage.renderStage(renderer, stageRect);
  present(renderer, stageRect, ctx);
}
/** Where drawLocker draws the preview: the canvas's top left, at the window's size. */
const stageRect: Rect = { x: 0, y: 0, width: 0, height: 0 };

/** Rebuilds the skier's and the preview's skis if a custom ski was painted since, and a painted garment. */
function repaintSkis(): void {
  // Checked by size first: iterating a set allocates, and this runs every preview frame.
  if (wearDirty.size > 0) {
    for (const garment of wearDirty) {
      skierView?.rig.repaintWear(garment);
      lockerStage.repaintWear(garment);
    }
    wearDirty.clear();
  }
  if (!skisDirty) return;
  skisDirty = false;
  skierView?.rig.repaintSkis();
  lockerStage.repaintSkis();
}

/** "Cheats on" in a corner while any cheat is on or the tuning panel has changed a number. */
function syncCheatsTag(): void {
  cheatsTag.hidden = !(anyCheat() || configChanged());
  if (!cheatsTag.hidden) raceCheats = true;
  // A combo ridden with any cheat on can't set a best, even if they're off again by the time it banks.
  taintCombo(score);
}

/** Esc on the bottom screen: the pause menu resumes; the title stays (there's nothing to go back to). */
function onRootBack(screen: Screen): void {
  if (screen === pauseScreen) closeMenus();
}

/** Back to riding. */
function closeMenus(): void {
  if (!level) return;
  menus.close();
  keyboard.setEnabled(true);
  keyboard.sample(keys);
  holdTime = 0;
}

/** Opens the full trail map of the map being ridden (the HUD button, or the pause menu's plank); the game waits behind it. */
function openTrailMap(fromPause = false): void {
  if (!level || !mapArt || (menus.isOpen && !fromPause)) return;
  if (fromPause) menus.close();
  trailFromPause = fromPause;
  keyboard.setEnabled(false);
  trailMap.open(mapArt, skier.position, skier.yaw, level.run.passed);
}

function closeTrailMap(): void {
  if (!trailMap.isOpen) return;
  trailMap.close();
  if (trailFromPause) {
    trailFromPause = false;
    openPause();
    return;
  }
  keyboard.setEnabled(true);
  keyboard.sample(keys);
  holdTime = 0;
}

/** The trail-map key while riding: shows or hides the corner map (saved), mid-air or on a rail alike. */
function toggleCornerMap(): void {
  // A lane map has no corner map (the full map is in the pause menu): the key does nothing there.
  if (!mapEntry(level?.id ?? null)?.cornerMap) return;
  settings.cornerMap = !settings.cornerMap;
  cornerMap.setShown(settings.cornerMap);
  saveSettings(settings);
  if (!settings.cornerMap) toast.show(`Corner map hidden (${mainInput(settings.bindings, settings.padBindings, 'trailMap')} shows it; the full map is in the pause menu)`);
}

/** A key pressed while no menu is open (the menus see it first, in Menus). */
function onGameKey(e: KeyboardEvent): void {
  // Typing in the multiplayer chat (milestone 27): the box handles its own keys.
  if (mp?.typing) return;
  // Riding, Tab never moves focus: it's the checkpoint key (or was, before rebinding).
  if (e.key === 'Tab') e.preventDefault();
  if (e.repeat) return;
  const pauseKey = e.key === 'Escape' || keyboard.isBound('pause', e.code);
  // While the trail map is open, its key or Esc closes it (game keys are off then); the pause key pauses.
  if (trailMap.isOpen && (e.key === 'Escape' || keyboard.isBound('trailMap', e.code))) {
    e.preventDefault();
    // Closing turns game keys back on; this same press mustn't then reach
    // the Keyboard (listening on window after this) and open the map again.
    e.stopPropagation();
    closeTrailMap();
    return;
  }
  if (pauseKey) {
    e.preventDefault();
    openPause();
  }
}

/** New key bindings from Settings: used at once, saved, and shown on the HUD. */
function setBindings(b: Bindings): void {
  settings.bindings = b;
  keyboard.setBindings(b);
  saveSettings(settings);
  syncKeyLabels();
}

/** HUD labels that name a key (or with a pad used last, a button), as bound now. */
function syncKeyLabels(): void {
  const name = (a: Parameters<typeof mainKey>[1]): string => mainInput(settings.bindings, settings.padBindings, a);
  setButtonKey(pauseButton, name('pause'));
  crashHint.setKey(name('respawn'), settings.crashWait);
  runHud.setKeys(name('confirm'), name('respawn'));
  raceAgainHint = `${name('respawn')}: race it again`;
  online?.finish.setKey(name('board'));
}

/**
 * Whether hints name the pad's buttons (a pad pressed something last) or the
 * keys (a key did), and how that pad names them (milestone 26). On a change
 * every label naming a key is drawn again. The first time a pad is used
 * while sound can't start yet (a pad press isn't a gesture the browser lets
 * start sound with), a note says what will.
 */
function setInputLook(pad: boolean, kind: PadKind): void {
  if (pad && !soundNoteShown && !sound.engine.running) {
    soundNoteShown = true;
    toast.show(isTouchScreen() ? 'Sound starts after a tap' : 'Sound starts after a click or a key press');
  }
  if (INPUT_LOOK.pad === pad && INPUT_LOOK.kind === kind) return;
  INPUT_LOOK.pad = pad;
  INPUT_LOOK.kind = kind;
  document.body.classList.toggle('pad-used', pad);
  syncKeyLabels();
  refreshHints();
  if (padTester.isShown) padTester.sync();
  // The pause menu names the keys that close it.
  if (level && menus.top === pauseScreen) {
    const resume = pad ? [mainPad(settings.padBindings, 'pause')] : [mainKey(settings.bindings, 'pause'), 'Esc'];
    pauseScreen.setInfo(mapEntry(level.id)?.name ?? '', resume, mainInput(settings.bindings, settings.padBindings, 'respawn'), (code) => keyboard.isBound('pause', code));
  }
}

/** The chase camera or first person: eased into, saved, and (from the camera key) said in a toast. */
function setCameraView(v: CameraView, announce: boolean): void {
  settings.camera = v;
  gameCamera.view = v;
  saveSettings(settings);
  if (!announce) return;
  const key = mainInput(settings.bindings, settings.padBindings, 'camera');
  toast.show(v === 'first' ? `First person (${key}: chase camera)` : `Chase camera (${key}: first person)`);
}

/** Switches to a quality preset (and remembers it): view range, decoration and pixel ratio. */
function setQuality(q: Quality): void {
  quality = q;
  settings.quality = q;
  saveSettings(settings);
  applyQuality();
}

/** What the quality setting draws now. */
function currentLevel(): QualityLevel {
  return qualityLevel(quality, auto.rung);
}

/** Applies what the quality setting draws now: the pixel ratio, the view range, and (if they changed) the decoration and snow effects. */
function applyQuality(): void {
  const next = currentLevel();
  setPixelRatio(view, pixelRatioFor(next));
  const rebuild = next.view !== drawn.view || next.detail !== drawn.detail;
  drawn = next;
  applyView();
  if (rebuild) level?.world.setQuality(decorDensity(next.detail), viewRange(next.view).far, snowBudget(next.detail));
  // A shorter or longer view can start the snow's chunks over: build the near ones at once.
  rebuildView = true;
  auto.hold();
}

/** Auto settled on a rung: remember it, so the next visit starts near it. */
function saveAutoRung(): void {
  if (settings.autoRung === auto.rung) return;
  settings.autoRung = auto.rung;
  saveSettings(settings);
}

/** The rung to try first: one better than `saved`, past any rung that draws the same as the one above it on this screen. */
function tryBetter(saved: number): number {
  const rungs = CONFIG.quality.auto.rungs;
  let r = clampRung(saved) - 1;
  while (r > 0 && sameLevel(rungs[r]!, rungs[r - 1]!)) r--;
  return Math.max(0, r);
}

/** A level's name for Settings: "Medium", or what it mixes ("Medium, Low view distance"). */
function levelName(l: QualityLevel): string {
  const name = (p: string): string => p[0]!.toUpperCase() + p.slice(1);
  if (l.view !== l.detail) return `${name(l.detail)}, ${name(l.view)} view distance`;
  const full = pixelRatioFor({ ...l, pixelRatio: CONFIG.quality.pixelRatio[l.view] });
  return pixelRatioFor(l) < full ? `${name(l.view)} at 1× sharpness` : name(l.view);
}

/** The current preset's view range, in this weather, on the camera and fog. */
function applyView(): void {
  // Only a map with far ranges has the far stand-in the haze can fade into; elsewhere the fog ends at the far plane.
  setViewRange(view, weatherRange(weather, viewRange(drawn.view), level?.built.map.peaks !== undefined));
}

/** Picks the weather for every map (and remembers it): it changes at once, behind any menu. */
function setWeather(w: WeatherId): void {
  weather = w;
  saveWeather(w);
  applyWeatherLook();
  sound.setWeather(w);
}

/** The weather's look on the map being ridden: sky, fog and lights, the view range, snow, night lights and the pumpkin's glow. */
function applyWeatherLook(): void {
  const look = weatherLook(weather, level?.built.map ?? null);
  applyWeather(view, look);
  SnowFx.setTint(look.fxTint);
  level?.world.setWeather(look);
  skierView?.rig.setGlow(look.def.glow);
  applyView();
}

/** Dev testing: puts the skier at (x, z) facing `heading` (radians), moving along the skis at `speed`. */
const tmp = new Vector3();
function teleport(x: number, z: number, heading: number, speed: number): void {
  if (!level) return;
  if (scoring()) endCombo(score, skier);
  resetRun(level.run);
  if (level.race) resetRace(level.race);
  placeSkierAt(skier, x, z, heading, level.built.hf);
  skier.velocity.copy(tmp.set(0, 0, -1).applyQuaternion(skier.orient)).multiplyScalar(speed);
  copySkierState(skierPrev, skier);
  snapView = true;
}

/** The live tuning panel: loaded (its own chunk, with lil-gui) the first time it's opened. */
let tuningPanel: TuningPanel | null = null;
let panelLoading: Promise<TuningPanel> | null = null;
function loadTuningPanel(): Promise<TuningPanel> {
  panelLoading ??= import('./ui/tuningPanel.ts').then(({ mountTuningPanel }) => {
    const panel = mountTuningPanel({
      changed: syncCheatsTag,
      shown: () => cheatsScreen.sync(),
      respawn,
      backToTop,
      teleport,
      setQuality,
      quality,
    });
    tuningPanel = panel;
    if (level) panel.setMap(level.built.map);
    return panel;
  });
  // A failed load can be tried again.
  panelLoading.catch(() => (panelLoading = null));
  return panelLoading;
}

if (import.meta.env.DEV) {
  // Dev builds open it at startup, folded up.
  void loadTuningPanel().then((p) => p.open(true));
  // Handle for inspecting the sim from the browser console while testing.
  Object.assign(window, {
    parkLaps: {
      skier,
      keys,
      /** Combo scoring's live state (sim/score.ts). */
      score,
      camera,
      scene,
      renderer,
      backdrop: view.backdrop,
      config: CONFIG,
      /** The numbers the sim runs on (CONFIG with the cheats); call rebuildTuning() after editing config. */
      tuning: TUNING,
      cheats: CHEATS,
      setCheat: (id: keyof typeof CHEATS, on: boolean) => {
        setCheat(id, on);
        syncCheatsTag();
        cheatsScreen.sync();
      },
      rebuildTuning: () => {
        rebuildTuning();
        syncCheatsTag();
      },
      respawn,
      backToTop,
      teleport,
      /** Rides a snowboard (regular, or goofy; optionally of a type: park, freeride, carving) or skis, this visit only (milestone 22; ?board=regular|goofy|skis does it from the start; the Locker saves it). */
      setRide: (board: boolean, goofy = false, type?: BoardId) => {
        setOutfit({ ...outfit, ride: board ? 'board' : 'skis', stance: board ? (goofy ? 'goofy' : 'regular') : outfit.stance, board: type && type in CONFIG.boards ? type : outfit.board }, false);
      },
      /** Posts a score to its online board as a banked best or a finished course would (use ?boards=test). */
      postScore,
      setQuality,
      setWeather,
      loadMap: (id: MapId) => loadMap(mapEntry(id)!),
      /** Multiplayer (milestone 27): make a lobby (resolves to its code), join one by code, and what this game sees. */
      mpCreate: async (map: string, title: string, open = true) => {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/v1/mp/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ map, title, open }) });
        return ((await res.json()) as { code: string }).code;
      },
      mpJoin: async (code: string) => (await loadMultiplayer()).join(code),
      mpDebug: () => mp?.debug() ?? null,
      get mp() {
        return mp;
      },
      /** The developer's powers (milestone 25), with the dev unlock: aim at (x, y, z) from the eye, held steady. */
      devAimAt: (x: number, y: number, z: number) => dev?.powers.aimAt(x, y, z),
      /** Looks from (x, y, z) at (tx, ty, tz) until called with no arguments, which goes back to the chase camera. */
      lookFrom: (...v: number[]) => {
        const [x = 0, y = 0, z = 0, tx = 0, ty = 0, tz = 0] = v;
        freeCamera = v.length === 6 ? { from: new Vector3(x, y, z), at: new Vector3(tx, ty, tz) } : null;
      },
      /** Snow height at (x, z), for aiming lookFrom. */
      heightAt: (x: number, z: number) => (level ? heightAt(level.built.hf, x, z) : 0),
      get map() {
        return level?.built.map;
      },
      get course() {
        return level?.built.course;
      },
      /** The whole built map (milestone 21: for timing the trail map's art, drawMapArt). */
      get built() {
        return level?.built;
      },
      get raceDef() {
        return level?.built.race;
      },
      get run() {
        return level?.run;
      },
      get race() {
        return level?.race;
      },
      get skierView() {
        return skierView;
      },
      /** The snow effects of the map being ridden; setWeather({ snowfall, ridgeSnow, wind, gust }) tries a storm. */
      get snowFx() {
        return level?.world.snow;
      },
      get outfit() {
        return outfit;
      },
      setOutfit,
      /** The game camera (milestone 18) and the switch the camera key makes ('chase' or 'first'). */
      gameCamera,
      setCameraView: (v: CameraView) => setCameraView(v, true),
      /** Sound: voices() reads each continuous sound's gain; play(id) plays a one-shot; renderWavs() saves every sound into .playwright-mcp/audio/. */
      audio: {
        voices: () => sound.voices(),
        play: (id: Parameters<GameAudio['play']>[0], strength?: number) => sound.play(id, strength),
        renderWavs: async () => (await import('./audio/wav.ts')).renderWavs(),
        engine: sound.engine,
        game: sound,
      },
    },
  });
}

// Start on the title, or straight on a map named in the URL (?map=park).
const fromUrl = mapEntry(new URLSearchParams(window.location.search).get('map'));
openTitle();
document.getElementById('boot')?.remove();
if (fromUrl?.load) void loadMap(fromUrl);

/** The rails before any map is loaded (the score HUD's, never allocated per frame). */
const NO_RAILS: readonly RailShape[] = [];

/** Scratch for the drawing buffer's size (the lamp halos and snow wisps are sized in its pixels). */
const bufferSize = new Vector2();

/** True while the game waits: no map yet, or a menu or the trail map is open. Nothing moves then. */
function gameWaits(): boolean {
  return !level || menus.isOpen || trailMap.isOpen || graphicsLost;
}

startLoop(
  (dt) => {
    if (!level) return;
    const { built, run, race } = level;
    // The developer's own keys drive nothing else while the powers work (Y flies and never opens the chat too).
    keyboard.setSkipped(devLive() && dev ? dev.ownKeys : null);
    keyboard.sample(keys);
    if (keys.trailMap.pressed) toggleCornerMap();
    // R: back to the checkpoint at once. Holding it keeps the skier there,
    // and after a moment goes back to the top instead.
    if (keys.respawn.pressed) {
      respawn();
      holdTime = 0;
      heldToTop = false;
    }
    if (keys.respawn.held) {
      // Real seconds, whatever the game speed.
      holdTime += dt / TUNING.sim.timeScale;
      if (!heldToTop && holdTime >= CONFIG.checkpoints.holdToTop) {
        heldToTop = true;
        backToTop();
      }
      return;
    }
    holdTime = 0;
    heldToTop = false;

    if (keys.confirm.pressed && run.finished) {
      backToTop();
      return;
    }
    if (keys.board.pressed && run.finished) toggleFinishBoard();
    if (keys.camera.pressed) setCameraView(settings.camera === 'first' ? 'chase' : 'first', true);
    if (keys.chat.pressed) mp?.openChat();
    if (keys.checkpoint.pressed) {
      if (timedRun()) {
        toast.show('No checkpoints on a timed run');
      } else if (canSetPersonal(skier)) {
        setPersonal(run, skier);
        toast.show('Checkpoint set');
      } else {
        toast.show(skier.bailed ? 'No checkpoints while crashing' : 'Checkpoints can only be set on the snow');
      }
    }

    copySkierState(skierPrev, skier);
    // Multiplayer (milestone 27): shot by the developer in the lobby crashes this rider, along the shot.
    const shot = mp?.takeHit();
    if (shot) knockDown(skier, built.hf, shot.x, shot.z);
    // The developer's powers (milestone 25): the fly key, aiming (it takes the arrows), a shot.
    dev?.powers.step(devLive(), skier, keys, dt);
    stepSkier(skier, keys, built.course, dt);
    // Stopped when the aim began (milestone 28): held where it stood until the aim ends.
    dev?.powers.hold(skier);
    // Avalanches (milestone 21): their slides run on the course, after the skier.
    const slides = built.course.avalanches;
    if (slides) {
      if (stepAvalanches(slides, skier, built.hf, dt) > 0) toast.show('Avalanche! Outrun it, or ski out to the side');
      if (skier.bailed && !skierPrev.bailed && skier.bailReason === 'avalanche') toast.show('Caught in the avalanche');
    }
    // The chairlift (milestone 17): say what's happening as the skier gets on, and cut straight to the top on a skip.
    if (skier.lift >= 0 && skierPrev.lift < 0) toast.show('Chairlift: the next chair picks you up');
    if (skier.liftChair >= 0 && skierPrev.liftChair < 0) toast.show(`Hold ${mainInput(settings.bindings, settings.padBindings, 'confirm')} to skip the ride`);
    if (skier.liftChair === -2 && skierPrev.liftChair >= 0 && skier.liftT > 0.5) snapView = true;
    sound.step(skierPrev, skier, built.course.rails);
    const event = updateRun(run, built.map, skierPrev.position, skier);
    // Flying (milestone 25) scores nothing: a combo under way is dropped at take-off, and scoring starts again on the snow.
    const flew = skier.flight !== 0 || skierPrev.flight !== 0;
    if (flew && skierPrev.flight === 0) resetScore(score);
    if (scoring() && !flew) stepScore(score, skierPrev, skier, built.course.rails, built.gaps, built.hf, dt);
    if (race && built.race) {
      const raceEvent = stepRace(race, built.race, skierPrev.position, skier, dt);
      if (raceEvent === 'missed') toast.show('Missed gate');
      if (raceEvent === 'start') {
        raceCheats = !cheatsTag.hidden;
        raceFlown = false;
      }
      if (skier.flight !== 0) raceFlown = true;
      // A clean run's time goes on the course's online board (a missed gate means no time; nor does flying).
      if (raceEvent === 'finish' && race.missed === 0 && !raceFlown) postScore(level.id, race.course, raceCheats, Math.round(race.time * 1000));
    }
    if (event === 'flag' && !timedRun()) toast.show(`Checkpoint: flag ${run.flag + 1} of ${built.map.flags.length}`);
    // After a crash, let the tumble play out, then fade and respawn (unless
    // the crash setting says to stay down until the respawn key).
    // A rider caught by an avalanche is carried along a while longer first.
    const downFor = skier.bailReason === 'avalanche' ? CONFIG.avalanche.respawnDelay : CONFIG.bail.respawnDelay;
    if (skier.bailed && !settings.crashWait && skier.bailTime >= downFor && !fader.busy) fader.fadeOut(respawn);
  },
  (alpha, realFrameTime) => {
    // While the game waits, everything that moves by time holds still too.
    // In slow motion it all slows with the sim; the HUD keeps real time.
    const waits = gameWaits();
    const hudTime = waits ? 0 : realFrameTime;
    const frameTime = hudTime * TUNING.sim.timeScale;
    if (level && skierView && chase) {
      interpolateSkier(pose, skierPrev, skier, alpha);
      const snapped = snapView;
      if (snapView) {
        skierView.snap(pose);
        gameCamera.snap();
        level.world.snow.snap(skier);
        snapView = false;
      }
      // The Locker always shows the plain pose; first person raises the arms into view.
      skierView.update(pose, frameTime, stageScreen ? 0 : gameCamera.firstWeight);
      orbit.take(drag);
      drag.active = orbit.dragging;
      // Aiming the developer's scope, a drag aims it instead of orbiting the camera.
      if (devLive()) dev?.powers.takeDrag(drag);
      gameCamera.update(chase, pose, skierView.rig, level.built.hf, frameTime, drag);
      // The developer's powers (milestone 25): through the scope (it overrides the camera), the carried model, a shot. Put away while the Locker shows.
      dev?.powers.frame(devLive() && !stageScreen, pose, skier, skierView.rig, camera, frameTime, level.built.course, level.world.snow, gameCamera.firstWeight);
      if (freeCamera) {
        camera.position.copy(freeCamera.from);
        camera.lookAt(freeCamera.at);
      }
      // Multiplayer (milestone 27): this rider's pose out, the others drawn from theirs (after every camera override: name tags face the camera drawn from).
      // The Locker's preview shows the paused world with only this rider in it (2026-11-24, the user's ask).
      mp?.frame(pose, camera, realFrameTime, waits, stageScreen !== null);
      level.world.view(camera.position.x, camera.position.z, camera.far, snapped || rebuildView, freeCamera !== null);
      rebuildView = false;
      level.world.update(level.run, level.race, frameTime, alpha);
      level.world.snow.update(pose, skier, frameTime, camera.position, skierView.skateSide);
      const fog = scene.fog as { near: number; far: number };
      const pxPerM = renderer.getDrawingBufferSize(bufferSize).y / (2 * Math.tan((camera.fov * Math.PI) / 360));
      SnowFx.setPointScale(pxPerM);
      const p = pose.position;
      level.world.lights.update(p.x, p.y, p.z, -Math.sin(pose.yaw), -Math.cos(pose.yaw), camera.position.x, camera.position.z, fog.near, fog.far, pxPerM);
      // The camera's right, flat, for panning places left and right.
      const m = camera.matrixWorld.elements;
      const flat = Math.hypot(m[0]!, m[2]!) || 1;
      sound.frame(waits, TUNING.sim.timeScale, skier, level.built.course.rails, m[0]! / flat, m[2]! / flat, level.world.snow.gust(), level.world.snow.inPowder);
    } else {
      sound.frame(true, 1, skier, NO_RAILS, 1, 0, 1, false);
    }

    // With no map, the menus' painted backdrop covers the canvas: drawing an empty scene behind it is wasted work.
    if (stageScreen) drawLocker(stageScreen, realFrameTime);
    else if (!warming && level) renderFrame(view);
    fader.update(hudTime);
    crashHint.show(pose.bailed);
    toast.update(hudTime);
    const race = level?.race;
    const course = timedCourse();
    raceHud.update(course !== undefined, course?.name ?? '', race?.time ?? 0, race?.missed ?? 0);
    const finished = level?.run.finished ?? false;
    const result = finished && race?.finished ? `${course?.name ?? ''} · ${formatTime(race.time)} · ${missedText(race.missed)}` : '';
    runHud.update(finished, result, result === '' ? '' : raceAgainHint, heldToTop ? 0 : holdTime);
    // While cheats are on (the "Cheats on" tag shows), the best shown is the map's cheats best.
    const cheats = !cheatsTag.hidden;
    scoreHud.update(scoring(), score, level?.built.course.rails ?? NO_RAILS, level ? bestCombo(level.id, cheats) : 0, cheats, hudTime);
    // The finish board opens with the finish panel and goes with it.
    if (finished !== finishSeen) {
      finishSeen = finished;
      boardHidden = false;
      if (finished) showFinishBoard();
      else online?.finish.hide();
    }
    // Multiplayer: the other riders in the lobby as dots on the corner map (none outside a lobby).
    if (level) cornerMap.update(pose.position.x, pose.position.z, pose.yaw, level.run.passed, mp ? mp.riderSpots(cornerMap.spots, SPOT_STRIDE, CORNER_RIDERS) : 0);
    fps.frame(realFrameTime);
    // Auto quality judges riding frames only (it holds off after jumps, loads and menus).
    if (quality === 'auto' && level) {
      const judged = auto.frame(realFrameTime, !waits);
      if (judged === 'down') applyQuality();
      if (judged !== null) saveAutoRung();
    }
    tuningPanel?.update(pose, skier);
  },
  gameWaits,
  (frameTime) => {
    // Controllers (milestone 26): read once a frame, before any step; nothing at all while none is connected.
    pads.poll();
    if (padTester.isShown) padTester.frame(frameTime);
    else if (gameWaits() && !padListen) padNav.frame(frameTime, pads.present ? pads.axes[3]! : 0);
    else padNav.reset();
  },
);

function mountCheatsTag(parent: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cheats-tag ride-only';
  el.textContent = 'Cheats on';
  el.hidden = true;
  parent.appendChild(el);
  return el;
}

function hudButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hud-button ride-only';
  b.dataset.label = label;
  b.addEventListener('click', () => {
    b.blur();
    onClick();
  });
  return b;
}

/** A HUD button's label with its key after it. */
function setButtonKey(b: HTMLButtonElement, key: string): void {
  const kbd = document.createElement('kbd');
  kbd.textContent = key;
  b.replaceChildren(document.createTextNode(b.dataset.label ?? ''), kbd);
}

/** Resolves on a fresh task, so a long job in slices lets the page paint between them. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Resolves after the browser has painted, so a status shown just before is on screen during long work. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el;
}

/** A message instead of the game, with a button (`label`, `action`) if given. */
function showFatal(message: string, label?: string, action?: () => void): void {
  document.getElementById('boot')?.remove();
  const el = document.createElement('div');
  el.className = 'fatal';
  const text = document.createElement('p');
  text.textContent = message;
  el.appendChild(text);
  if (label && action) {
    el.classList.add('is-over-game');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', action);
    el.appendChild(b);
    hud.appendChild(el);
    b.focus();
    return;
  }
  hud.appendChild(el);
}
