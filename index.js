/**
 * @format
 */

import {AppRegistry} from 'react-native';
import {enableScreens} from 'react-native-screens';
import App from './App';

enableScreens();
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);
