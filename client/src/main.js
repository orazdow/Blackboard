import { render } from 'solid-js/web';
import App from './ui.js';

// Experimental GitHub Discussions integration. Set true to enable Task / Talk.
const ENABLE_DISCUSSIONS = false;

render(() => App({ discussionsEnabled: ENABLE_DISCUSSIONS }), document.querySelector('#app'));
