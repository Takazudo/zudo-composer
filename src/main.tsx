import { render } from 'preact';
import { App } from './App';
import './style.css';

const root = document.querySelector('#app');

if (!root) {
  throw new Error('Missing #app mount point');
}

render(<App />, root);
