import './style.css';
import { App } from './ui/App';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('App root was not found.');
}

new App(root);
