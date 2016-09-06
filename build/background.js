(function () {'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var electron = require('electron');
var jetpack = _interopDefault(require('fs-jetpack'));
var path = _interopDefault(require('path'));
var fs = _interopDefault(require('fs'));
var url = _interopDefault(require('url'));

var setDevMenu = function () {
    var devMenu = electron.Menu.buildFromTemplate([{
        label: 'Development',
        submenu: [{
            label: 'Reload',
            accelerator: 'CmdOrCtrl+R',
            click: function () {
                electron.BrowserWindow.getFocusedWindow().webContents.reloadIgnoringCache();
            }
        },{
            label: 'Toggle DevTools',
            accelerator: 'Alt+CmdOrCtrl+I',
            click: function () {
                electron.BrowserWindow.getFocusedWindow().toggleDevTools();
            }
        },{
            label: 'Quit',
            accelerator: 'CmdOrCtrl+Q',
            click: function () {
                electron.app.quit();
            }
        }]
    }]);
    electron.Menu.setApplicationMenu(devMenu);
};

var devHelper = {
    setDevMenu: setDevMenu,
}

function windowStateKeeper (name, defaults) {

    var userDataDir = jetpack.cwd(electron.app.getPath('userData'));
    var stateStoreFile = 'window-state-' + name +'.json';
    var state = {
        width: defaults.width,
        height: defaults.height
    };

    try {
        var loadedState = userDataDir.read(stateStoreFile, 'json');
        if (loadedState != null) {
            state = loadedState;
        }
    } catch (err) {
        // For some reason json can't be read.
        // No worries, we have defaults.
    }

    var saveState = function (win) {
        if (!win.isMaximized() && !win.isMinimized() && win.isVisible()) {
            var position = win.getPosition();
            var size = win.getSize();
            state.x = position[0];
            state.y = position[1];
            state.width = size[0];
            state.height = size[1];
        }
        state.isMaximized = win.isMaximized();
        state.isMinimized = win.isMinimized();
        state.isHidden = !win.isMinimized() && !win.isVisible();
        userDataDir.write(stateStoreFile, state, { atomic: true });
    };

    return {
        get x() { return state.x; },
        get y() { return state.y; },
        get width() { return state.width; },
        get height() { return state.height; },
        get isMaximized() { return state.isMaximized; },
        get isMinimized() { return state.isMinimized; },
        get isHidden() { return state.isHidden; },
        saveState: saveState
    };
}

class CertificateStore {
	constructor() {
		this.storeFile = path.resolve(electron.app.getPath('userData'), 'certificate.json');
		this.load();
	}

	initWindow(win) {
		this.window = win;
		electron.app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
			if (this.isTrusted(url, certificate)) {
				event.preventDefault();
				callback(true);
				return;
			}

			var detail = `URL: ${url}\nError: ${error}`;
			if (this.isExisting(url)) {
				detail = `Certificate is different from previous one.\n\n` + detail;
			}

			electron.dialog.showMessageBox(this.window, {
				title: 'Certificate error',
				message: `Do you trust certificate from "${certificate.issuerName}"?`,
				detail: detail,
				type: 'warning',
				buttons: [
					'Yes',
					'No'
				],
				cancelId: 1
			}, (response) => {
				if (response === 0) {
					this.add(url, certificate);
					this.save();
					if (webContents.getURL().indexOf('file://') === 0) {
						webContents.send('certificate-reload', url);
					} else {
						webContents.loadURL(url);
					}
				}
			});
			callback(false);
		});
	}

	load() {
		try {
			this.data = JSON.parse(fs.readFileSync(this.storeFile, 'utf-8'));
		}
		catch (e) {
			console.log(e);
			this.data = {};
		}
	}

	clear() {
		this.data = {};
		this.save();
	}

	save() {
		fs.writeFileSync(this.storeFile, JSON.stringify(this.data));
	}

	parseCertificate(certificate) {
		return certificate.issuerName + '\n' + certificate.data.toString();
	}

	getHost(certUrl) {
		return url.parse(certUrl).host;
	}

	add(certUrl, certificate) {
		const host = this.getHost(certUrl);
		this.data[host] = this.parseCertificate(certificate);
	}

	isExisting(certUrl) {
		const host = this.getHost(certUrl);
		return this.data.hasOwnProperty(host);
	}

	isTrusted(certUrl, certificate) {
		var host = this.getHost(certUrl);
		if (!this.isExisting(certUrl)) {
			return false;
		}
		return this.data[host] === this.parseCertificate(certificate);
	}
}

const certificateStore = new CertificateStore();

var app$1;
if (process.type === 'renderer') {
    app$1 = require('electron').remote.app;
} else {
    app$1 = require('electron').app;
}
var appDir = jetpack.cwd(app$1.getAppPath());

var manifest = appDir.read('package.json', 'json');

var env = manifest.env;

var mainWindow;

if (process.platform !== 'darwin') {
    var shouldQuit = electron.app.makeSingleInstance(function() {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    if (shouldQuit) {
        electron.app.quit();
    }
}

// Preserver of the window size and position between app launches.
var mainWindowState = windowStateKeeper('main', {
    width: 1000,
    height: 600
});

electron.app.on('ready', function () {

    mainWindow = new electron.BrowserWindow({
        x: mainWindowState.x,
        y: mainWindowState.y,
        width: mainWindowState.width,
        height: mainWindowState.height,
        minWidth: 600,
        minHeight: 400
    });

    if (mainWindowState.isMaximized) {
        mainWindow.maximize();
    }

    if (mainWindowState.isMinimized) {
        mainWindow.minimize();
    }

    if (mainWindowState.isHidden) {
        mainWindow.hide();
    }

    if (env.name === 'test') {
        mainWindow.loadURL('file://' + __dirname + '/spec.html');
    } else {
        mainWindow.loadURL('file://' + __dirname + '/app.html');
    }

    if (env.name !== 'production') {
        devHelper.setDevMenu();
        mainWindow.openDevTools();
    }

    mainWindow.on('close', function (event) {
        if (mainWindow.forceClose) {
            mainWindowState.saveState(mainWindow);
            return;
        }
        event.preventDefault();
        mainWindow.hide();
        mainWindowState.saveState(mainWindow);
    });

    electron.app.on('before-quit', function() {
        mainWindowState.saveState(mainWindow);
        mainWindow.forceClose = true;
    });

    mainWindow.on('resize', function() {
        mainWindowState.saveState(mainWindow);
    });

    mainWindow.on('move', function() {
        mainWindowState.saveState(mainWindow);
    });

    electron.app.on('activate', function(){
        mainWindow.show();
    });

    mainWindow.webContents.on('will-navigate', function(event) {
        event.preventDefault();
    });

    certificateStore.initWindow(mainWindow);
});

electron.app.on('window-all-closed', function () {
    electron.app.quit();
});
}());
//# sourceMappingURL=background.js.map