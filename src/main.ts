import './style.css';
import { App } from './ui/app';
import { registerServiceWorker } from './ui/notify';
import { keepScreenOn } from './ui/wakelock';

void new App(document.getElementById('app')!).start();
void registerServiceWorker();
keepScreenOn();
