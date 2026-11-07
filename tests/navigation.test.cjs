const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/app.js', 'utf8');
const navigation = source.slice(source.indexOf('  function navigateNodes('), source.indexOf('  function getSelectedNodeList('));
function setup(selected = 'root') {
  const context = {
    selectedNodeId: selected, aiInlineNodeId: null, panX: 300, panY: 300, zoom: 1,
    layoutPositions: new Map(),
    getActiveBoard: () => ({root: {id: 'root'}}),
    hideAllPopovers() {}, renderCanvas() {}, updateViewportTransform() {},
    canvasViewport: {getBoundingClientRect: () => ({width: 600, height: 600})}
  };
  context.selectSingleNode = id => { context.selectedNodeId = id; };
  for (const [id, x, y] of [['root',0,0], ['left',-200,0], ['right',200,0], ['up',0,-200], ['down',0,200]]) {
    context.layoutPositions.set(id, {x, y, w: 100, h: 50});
  }
  vm.createContext(context);
  vm.runInContext(navigation, context);
  return context;
}

test('arrows navigate in all four visual directions', () => {
  for (const [key, id] of [['ArrowLeft','left'], ['ArrowRight','right'], ['ArrowUp','up'], ['ArrowDown','down']]) {
    const context = setup();
    context.navigateNodes(key);
    assert.equal(context.selectedNodeId, id);
  }
});

test('navigation starts at root and stays put at the map edge', () => {
  const context = setup(null);
  context.navigateNodes('ArrowLeft');
  assert.equal(context.selectedNodeId, 'root');
  context.navigateNodes('ArrowLeft');
  context.navigateNodes('ArrowLeft');
  assert.equal(context.selectedNodeId, 'left');
});

test('navigation skips hidden nodes and brings offscreen nodes into view', () => {
  const context = setup();
  context.layoutPositions.delete('right');
  context.layoutPositions.set('far', {x: 1500, y: 0, w: 100, h: 50});
  context.navigateNodes('ArrowRight');
  assert.equal(context.selectedNodeId, 'far');
  assert.equal(context.panX + 1550 * context.zoom, 300);
});
