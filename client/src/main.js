import { render } from 'solid-js/web';
import App from './ui.js';
import { repositoryFromPagesUrl } from './repository-state.js';

// Experimental GitHub Discussions integration. Set true to enable Task / Talk.
const ENABLE_DISCUSSIONS = false;
// Public default only. Credentials are entered at runtime through Permit.
const DEFAULT_REPOSITORY = import.meta.BLACKBOARD_REPOSITORY || repositoryFromPagesUrl(window.location.href) || 'orazdow/Blackboard';

render(() => App({ discussionsEnabled: ENABLE_DISCUSSIONS, defaultRepository: DEFAULT_REPOSITORY }), document.querySelector('#app'));
