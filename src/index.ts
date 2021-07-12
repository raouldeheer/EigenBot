import ApiManager from './api';
import Eigenbot from './eigenbot';
import minecraftVersion from './minecraft-version';
import scicraft from './scicraft';

const path = './config.json';
const modules = [
  Eigenbot,
  scicraft,
  minecraftVersion,
];

new ApiManager(path, modules).start();
