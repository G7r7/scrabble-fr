import './style.css';
import { App } from './ui/app';
import { registerServiceWorker } from './ui/notify';

void new App(document.getElementById('app')!).start();
void registerServiceWorker();
