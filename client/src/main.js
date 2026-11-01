import { render } from 'solid-js/web';
import App from './ui.js';
import { defaultRepositoryForUrl } from './repository-state.js';

// Experimental GitHub Discussions integration.
const ENABLE_DISCUSSIONS = false;
// Optional GitHub Projects integration.
const ENABLE_PROJECTS = false;
// Public repository selection only. Credentials are entered at runtime.
const DEFAULT_REPOSITORY = defaultRepositoryForUrl(window.location.href, import.meta.BLACKBOARD_REPOSITORY);

render(() => App({ discussionsEnabled: ENABLE_DISCUSSIONS, projectsEnabled: ENABLE_PROJECTS, defaultRepository: DEFAULT_REPOSITORY }), document.querySelector('#app'));
