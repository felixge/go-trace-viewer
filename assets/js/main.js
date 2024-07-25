import { h, render } from 'preact';
import { App } from './components.js';
import htm from 'htm';
const html = htm.bind(h);

render(html`<${App}/>`, document.body);