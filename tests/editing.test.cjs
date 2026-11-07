const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/app.js', 'utf8');
const editor = source.slice(source.indexOf('        let editCommitted = false;'), source.indexOf('        header.appendChild(ta);'));
const shortcuts = source.slice(source.indexOf('      if (ev.key === "Tab" || ev.key === "Enter")'), source.indexOf('      if (ev.key === "F2")'));
function setup(isRoot = false) {
  const handlers = {};
  const node = {id: 'node', text: 'Old title'};
  const context = {
    node, isRoot, nType: 'text', board: {title: 'Old title'},
    editingNodeId: node.id, selectedNodeId: null, commits: 0, siblings: 0,
    ta: {value: 'New title', addEventListener: (name, handler) => { handlers[name] = handler; }},
    t: () => 'New Branch', pushHistory() {}, renderRail() {}, renderCanvas() {},
    scheduleSave() { context.commits++; },
    selectSingleNode(id) { context.selectedNodeId = id; },
    addSiblingNode() { context.siblings++; },
    getActiveBoard() { return context.board; }
  };
  vm.createContext(context);
  vm.runInContext(editor, context);
  function press(options = {}) {
    const event = {key: 'Enter', prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...options};
    if (context.editingNodeId) handlers.keydown(event);
    else {
      context.ev = event;
      vm.runInContext('(function () {' + shortcuts + '})()', context);
    }
    return event;
  }
  return {context, handlers, press};
}

test('first Enter saves and exits editing; second Enter creates a sibling', () => {
  for (const root of [false, true]) {
    const {context, handlers, press} = setup(root);
    assert.equal(press().prevented, true);
    assert.equal(context.node.text, 'New title');
    assert.equal(context.editingNodeId, null);
    assert.equal(context.selectedNodeId, 'node');
    assert.equal(context.siblings, 0);
    handlers.blur();
    assert.equal(context.commits, 1);
    press({repeat: true});
    assert.equal(context.siblings, 0);
    press();
    assert.equal(context.siblings, 1);
    if (root) assert.equal(context.board.title, 'New title');
  }
});

test('Shift+Enter and IME confirmation leave the editor open', () => {
  for (const options of [{shiftKey: true}, {isComposing: true}, {keyCode: 229}]) {
    const {context, press} = setup();
    assert.equal(press(options).prevented, false);
    assert.equal(context.editingNodeId, 'node');
    assert.equal(context.commits, 0);
  }
});
