(function () {'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var electron = require('electron');
var events = require('events');
var webFrame = _interopDefault(require('web-frame'));
var path = _interopDefault(require('path'));

// Add your custom JS code here

const remoteServers = electron.remote.require('./servers');

class Servers extends events.EventEmitter {
	constructor() {
		super();
		this.load();
	}

	get hosts() {
		return this._hosts;
	}

	set hosts(hosts) {
		this._hosts = hosts;
		this.save();
		return true;
	}

	get hostsKey() {
		return 'rocket.chat.hosts';
	}

	get activeKey() {
		return 'rocket.chat.currentHost';
	}

	load() {
		var hosts = localStorage.getItem(this.hostsKey);

		try {
			hosts = JSON.parse(hosts);
		} catch (e) {
			if (typeof hosts === 'string' && hosts.match(/^https?:\/\//)) {
				hosts = {};
				hosts[hosts] = {
					title: hosts,
					url: hosts
				};
			}

			localStorage.setItem(this.hostsKey, JSON.stringify(hosts));
		}

		if (hosts === null) {
			hosts = {};
		}

		if (Array.isArray(hosts)) {
			var oldHosts = hosts;
			hosts = {};
			oldHosts.forEach(function(item) {
				item = item.replace(/\/$/, '');
				hosts[item] = {
					title: item,
					url: item
				};
			});
			localStorage.setItem(this.hostsKey, JSON.stringify(hosts));
		}

		this._hosts = hosts;
		remoteServers.loadServers(this._hosts);
		this.emit('loaded');
	}

	save() {
		localStorage.setItem(this.hostsKey, JSON.stringify(this._hosts));
		this.emit('saved');
	}

	get(hostUrl) {
		return this.hosts[hostUrl];
	}

	forEach(cb) {
		for (var host in this.hosts) {
			if (this.hosts.hasOwnProperty(host)) {
				cb(this.hosts[host]);
			}
		}
	}

	validateHost(hostUrl, timeout) {
		console.log('Validating hostUrl', hostUrl);
		timeout = timeout || 5000;
		return new Promise(function(resolve, reject) {
			var resolved = false;
			$.getJSON(`${hostUrl}/api/info`).then(function() {
				if (resolved) {
					return;
				}
				resolved = true;
				console.log('HostUrl valid', hostUrl);
				resolve();
			}, function(request) {
				if (request.status === 401) {
					let authHeader = request.getResponseHeader('www-authenticate');
					if (authHeader && authHeader.toLowerCase().indexOf('basic ') === 0) {
						resolved = true;
						console.log('HostUrl needs basic auth', hostUrl);
						reject('basic-auth');
					}
				}
				if (resolved) {
					return;
				}
				resolved = true;
				console.log('HostUrl invalid', hostUrl);
				reject('invalid');
			});
			if (timeout) {
				setTimeout(function() {
					if (resolved) {
						return;
					}
					resolved = true;
					console.log('Validating hostUrl TIMEOUT', hostUrl);
					reject('timeout');
				}, timeout);
			}
		});
	}

	hostExists(hostUrl) {
		var hosts = this.hosts;

		return !!hosts[hostUrl];
	}

	addHost(hostUrl) {
		var hosts = this.hosts;

		let match = hostUrl.match(/^(https?:\/\/)([^:]+):([^@]+)@(.+)$/);
		let username;
		let password;
		let authUrl;
		if (match) {
			authUrl = hostUrl;
			hostUrl = match[1] + match[4];
			username = match[2];
			password = match[3];
		}

		if (this.hostExists(hostUrl) === true) {
			return false;
		}

		hosts[hostUrl] = {
			title: hostUrl,
			url: hostUrl,
			authUrl: authUrl,
			username: username,
			password: password
		};
		this.hosts = hosts;

		remoteServers.loadServers(this.hosts);

		this.emit('host-added', hostUrl);

		return hostUrl;
	}

	removeHost(hostUrl) {
		var hosts = this.hosts;
		if (hosts[hostUrl]) {
			delete hosts[hostUrl];
			this.hosts = hosts;

			remoteServers.loadServers(this.hosts);

			if (this.active === hostUrl) {
				this.clearActive();
			}
			this.emit('host-removed', hostUrl);
		}
	}

	get active() {
		return localStorage.getItem(this.activeKey);
	}

	setActive(hostUrl) {
		if (this.hostExists(hostUrl)) {
			localStorage.setItem(this.activeKey, hostUrl);
			this.emit('active-setted', hostUrl);
			return true;
		}
		return false;
	}

	restoreActive() {
		this.setActive(this.active);
	}

	clearActive() {
		localStorage.removeItem(this.activeKey);
		this.emit('active-cleared');
		return true;
	}

	setHostTitle(hostUrl, title) {
		if (title === 'Rocket.Chat' && /https?:\/\/demo\.rocket\.chat/.test(hostUrl) === false) {
			title += ' - ' + hostUrl;
		}
		var hosts = this.hosts;
		hosts[hostUrl].title = title;
		this.hosts = hosts;
		this.emit('title-setted', hostUrl, title);
	}
}

var servers = new Servers();

class WebView extends events.EventEmitter {
	constructor() {
		super();

		this.webviewParentElement = document.body;

		servers.forEach((host) => {
			this.add(host);
		});

		servers.on('host-added', (hostUrl) => {
			this.add(servers.get(hostUrl));
		});

		servers.on('host-removed', (hostUrl) => {
			this.remove(hostUrl);
		});

		servers.on('active-setted', (hostUrl) => {
			this.setActive(hostUrl);
		});

		servers.on('active-cleared', (hostUrl) => {
			this.deactiveAll(hostUrl);
		});
	}

	add(host) {
		var webviewObj = this.getByUrl(host.url);
		if (webviewObj) {
			return;
		}

		webviewObj = document.createElement('webview');
		webviewObj.setAttribute('server', host.url);
		webviewObj.setAttribute('preload', './scripts/preload.js');
		webviewObj.setAttribute('allowpopups', 'on');
		webviewObj.setAttribute('disablewebsecurity', 'on');

		webviewObj.addEventListener('did-navigate-in-page', (lastPath) => {
			this.saveLastPath(host.url, lastPath.url);
		});

		webviewObj.addEventListener('console-message', function(e) {
			console.log('webview:', e.message);
		});

		webviewObj.addEventListener('ipc-message', (event) => {
			this.emit('ipc-message-'+event.channel, host.url, event.args);

			switch (event.channel) {
				case 'title-changed':
					servers.setHostTitle(host.url, event.args[0]);
					break;
				case 'unread-changed':
					sidebar.setBadge(host.url, event.args[0]);
					break;
				case 'focus':
					servers.setActive(host.url);
					break;
			}
		});

		webviewObj.addEventListener('dom-ready', () => {
			this.emit('dom-ready', host.url);
		});

		this.webviewParentElement.appendChild(webviewObj);

		webviewObj.src = host.lastPath || host.url;
	}

	remove(hostUrl) {
		var el = this.getByUrl(hostUrl);
		if (el) {
			el.remove();
		}
	}

	saveLastPath(hostUrl, lastPathUrl) {
		var hosts = servers.hosts;
		hosts[hostUrl].lastPath = lastPathUrl;
		servers.hosts = hosts;
	}

	getByUrl(hostUrl) {
		return this.webviewParentElement.querySelector(`webview[server="${hostUrl}"]`);
	}

	getActive() {
		return document.querySelector('webview.active');
	}

	isActive(hostUrl) {
		return !!this.webviewParentElement.querySelector(`webview.active[server="${hostUrl}"]`);
	}

	deactiveAll() {
		var item;
		while (!(item = this.getActive()) === false) {
			item.classList.remove('active');
		}
	}

	setActive(hostUrl) {
		console.log('active setted', hostUrl);
		if (this.isActive(hostUrl)) {
			return;
		}

		this.deactiveAll();
		var item = this.getByUrl(hostUrl);
		if (item) {
			item.classList.add('active');
		}

		this.focusActive();
	}

	focusActive() {
		var active = this.getActive();
		if (active) {
			active.focus();
			return true;
		}
		return false;
	}
}

var webview = new WebView();

var Menu$1 = electron.remote.Menu;
var APP_NAME = electron.remote.app.getName();
var template;

var certificate = electron.remote.require('./certificate');

document.title = APP_NAME;

if (process.platform === 'darwin') {
	template = [
		{
			label: APP_NAME,
			submenu: [
				{
					label: 'About ' + APP_NAME,
					role: 'about'
				},
				{
					type: 'separator'
				},
				{
					label: 'Hide ' + APP_NAME,
					accelerator: 'Command+H',
					role: 'hide'
				},
				{
					label: 'Hide Others',
					accelerator: 'Command+Alt+H',
					role: 'hideothers'
				},
				{
					label: 'Show All',
					role: 'unhide'
				},
				{
					type: 'separator'
				},
				{
					label: 'Quit ' + APP_NAME,
					accelerator: 'Command+Q',
					click: function() {
						electron.remote.app.quit();
					}
				}
			]
		},
		{
			label: 'Edit',
			submenu: [
				{
					label: 'Undo',
					accelerator: 'Command+Z',
					role: 'undo'
				},
				{
					label: 'Redo',
					accelerator: 'Command+Shift+Z',
					role: 'redo'
				},
				{
					type: 'separator'
				},
				{
					label: 'Cut',
					accelerator: 'Command+X',
					role: 'cut'
				},
				{
					label: 'Copy',
					accelerator: 'Command+C',
					role: 'copy'
				},
				{
					label: 'Paste',
					accelerator: 'Command+V',
					role: 'paste'
				},
				{
					label: 'Select All',
					accelerator: 'Command+A',
					role: 'selectall'
				}
			]
		},
		{
			label: 'View',
			submenu: [
				{
					label: 'Original Zoom',
					accelerator: 'Command+0',
					click: function() {
						webFrame.setZoomLevel(0);
					}
				},
				{
					label: 'Zoom In',
					accelerator: 'Command+=',
					click: function() {
						webFrame.setZoomLevel(webFrame.getZoomLevel()+1);
					}
				},
				{
					label: 'Zoom Out',
					accelerator: 'Command+-',
					click: function() {
						webFrame.setZoomLevel(webFrame.getZoomLevel()-1);
					}
				},
				{
					type: 'separator'
				},
				{
					label: 'Current Server - Reload',
					accelerator: 'Command+R',
					click: function() {
						const activeWebview = webview.getActive();
						if (activeWebview) {
							activeWebview.reload();
						}
					}
				},
				{
					label: 'Current Server - Toggle DevTools',
					accelerator: 'Command+Alt+I',
					click: function() {
						const activeWebview = webview.getActive();
						if (activeWebview) {
							activeWebview.openDevTools();
						}
					}
				},
				{
					type: 'separator'
				},
				{
					label: 'Application - Reload',
					accelerator: 'Command+Shift+R',
					click: function() {
						var mainWindow = electron.remote.getCurrentWindow();
						if (mainWindow.tray) {
							mainWindow.tray.destroy();
						}
						mainWindow.reload();
					}
				},
				{
					label: 'Application - Toggle DevTools',
					click: function() {
						electron.remote.getCurrentWindow().toggleDevTools();
					}
				},
				{
					type: 'separator'
				},
				{
					label: 'Toggle server list',
					click: function() {
						sidebar.toggle();
					}
				},
				{
					type: 'separator'
				},
				{
					label: 'Clear',
					submenu: [
						{
							label: 'Clear Trusted Certificates',
							click: function() {
								certificate.clear();
							}
						}
					]
				}
			]
		},
		{
			label: 'Window',
			id: 'window',
			role: 'window',
			submenu: [
				{
					label: 'Minimize',
					accelerator: 'Command+M',
					role: 'minimize'
				},
				{
					label: 'Close',
					accelerator: 'Command+W',
					role: 'close'
				},
				{
					type: 'separator'
				},
				{
					type: 'separator',
					id: 'server-list-separator',
					visible: false
				},
				{
					label: 'Add new server',
					accelerator: 'Command+N',
					click: function() {
						var mainWindow = electron.remote.getCurrentWindow();
						mainWindow.show();
						servers.clearActive();
					}
				},
				{
					type: 'separator'
				},
				{
					label: 'Bring All to Front',
					click: function() {
						var mainWindow = electron.remote.getCurrentWindow();
						mainWindow.show();
					}
				}
			]
		},
		{
			label: 'Help',
			role: 'help',
			submenu: [
				{
					label: APP_NAME + ' Help',
					click: function() {
						electron.remote.shell.openExternal('https://rocket.chat/docs');
					}
				},
				{
					type: 'separator'
				},
				{
					label: 'Learn More',
					click: function() {
						electron.remote.shell.openExternal('https://rocket.chat');
					}
				}
			]
		}
	];
} else {
	template = [
		{
			label: '&' + APP_NAME,
			submenu: [
				{
					label: 'About ' + APP_NAME,
					click: function() {
						const win = new electron.remote.BrowserWindow({ width: 310, height: 200, minWidth: 310, minHeight: 200, maxWidth: 310, maxHeight: 200, show: false, maximizable: false, minimizable: false, title: ' ' });
						win.loadURL('file://' + __dirname + '/about.html');
						win.show();
					}
				},
				{
					type: 'separator'
				},
				{
					label: 'Quit',
					accelerator: 'Ctrl+Q',
					click: function() {
						electron.remote.app.quit();
					}
				}
			]
		},
		{
			label: '&Edit',
			submenu: [
				{
					label: 'Undo',
					accelerator: 'Ctrl+Z',
					role: 'undo'
				},
				{
					label: 'Redo',
					accelerator: 'Ctrl+Shift+Z',
					role: 'redo'
				},
				{
					type: 'separator'
				},
				{
					label: 'Cut',
					accelerator: 'Ctrl+X',
					role: 'cut'
				},
				{
					label: 'Copy',
					accelerator: 'Ctrl+C',
					role: 'copy'
				},
				{
					label: 'Paste',
					accelerator: 'Ctrl+V',
					role: 'paste'
				},
				{
					label: 'Select All',
					accelerator: 'Ctrl+A',
					role: 'selectall'
				}
			]
		},
		{
			label: '&View',
			submenu: [
				{
					label: 'Original Zoom',
					accelerator: 'Command+0',
					click: function() {
						webFrame.setZoomLevel(0);
					}
				},
				{
					label: 'Zoom In',
					accelerator: 'Command+=',
					click: function() {
						webFrame.setZoomLevel(webFrame.getZoomLevel()+1);
					}
				},
				{
					label: 'Zoom Out',
					accelerator: 'Command+-',
					click: function() {
						webFrame.setZoomLevel(webFrame.getZoomLevel()-1);
					}
				},
				{
					type: 'separator'
				},
				{
					label: 'Current Server - Reload',
					accelerator: 'Ctrl+R',
					click: function() {
						const activeWebview = webview.getActive();
						if (activeWebview) {
							activeWebview.reload();
						}
					}
				},
				{
					label: 'Current Server - Toggle DevTools',
					accelerator: 'Ctrl+Shift+I',
					click: function() {
						const activeWebview = webview.getActive();
						if (activeWebview) {
							activeWebview.openDevTools();
						}
					}
				},
				{
					type: 'separator'
				},
				{
					label: 'Application - Reload',
					accelerator: 'Ctrl+Shift+R',
					click: function() {
						var mainWindow = electron.remote.getCurrentWindow();
						if (mainWindow.tray) {
							mainWindow.tray.destroy();
						}
						mainWindow.reload();
					}
				},
				{
					label: 'Application - Toggle DevTools',
					click: function() {
						electron.remote.getCurrentWindow().toggleDevTools();
					}
				},
				{
					type: 'separator'
				},
				{
					label: 'Toggle server list',
					click: function() {
						sidebar.toggle();
					}
				},
				{
					type: 'separator'
				},
				{
					label: 'Clear',
					submenu: [
						{
							label: 'Clear Trusted Certificates',
							click: function() {
								certificate.clear();
							}
						}
					]
				}
			]
		},
		{
			label: '&Window',
			id: 'window',
			submenu: [
				{
					type: 'separator',
					id: 'server-list-separator',
					visible: false
				},
				{
					label: 'Add new server',
					accelerator: 'Ctrl+N',
					click: function() {
						servers.clearActive();
					}
				},
				{
					type: 'separator'
				},
				{
					label: 'Close',
					accelerator: 'Ctrl+W',
					click: function() {
						electron.remote.getCurrentWindow().close();
					}
				}
			]
		}
	];
}

var menuTemplate = template;
var menu = Menu$1.buildFromTemplate(template);

Menu$1.setApplicationMenu(menu);

var Menu = electron.remote.Menu;

var windowMenuPosition = menuTemplate.findIndex(function(i) {return i.id === 'window';});
var windowMenu = menuTemplate[windowMenuPosition];
var serverListSeparatorPosition = windowMenu.submenu.findIndex(function(i) {return i.id === 'server-list-separator';});
var serverListSeparator = windowMenu.submenu[serverListSeparatorPosition];

class SideBar extends events.EventEmitter {
	constructor() {
		super();

		this.hostCount = 0;

		this.listElement = document.getElementById('serverList');

		servers.forEach((host) => {
			this.add(host);
		});

		servers.on('host-added', (hostUrl) => {
			this.add(servers.get(hostUrl));
		});

		servers.on('host-removed', (hostUrl) => {
			this.remove(hostUrl);
		});

		servers.on('active-setted', (hostUrl) => {
			this.setActive(hostUrl);
		});

		servers.on('active-cleared', (hostUrl) => {
			this.deactiveAll(hostUrl);
		});

		servers.on('title-setted', (hostUrl, title) => {
			this.setLabel(hostUrl, title);
		});

		webview.on('dom-ready', (hostUrl) => {
			this.setImage(hostUrl);
		});

		if (this.isHidden()) {
			this.hide();
		} else {
			this.show();
		}
	}

	add(host) {
		var name = host.title.replace(/^https?:\/\/(?:www\.)?([^\/]+)(.*)/, '$1');
		name = name.split('.');
		name = name[0][0] + (name[1] ? name[1][0] : '');
		name = name.toUpperCase();

		var initials = document.createElement('span');
		initials.innerHTML = name;

		var tooltip = document.createElement('div');
		tooltip.classList.add('tooltip');
		tooltip.innerHTML = host.title;

		var badge = document.createElement('div');
		badge.classList.add('badge');

		var img = document.createElement('img');
		img.onload = function() {
			img.style.display = 'initial';
			initials.style.display = 'none';
		};
		// img.src = `${host.url}/assets/favicon.svg?v=${Math.round(Math.random()*10000)}`;

		var hotkey = document.createElement('div');
		hotkey.classList.add('name');
		if (process.platform === 'darwin') {
			hotkey.innerHTML = '⌘' + (++this.hostCount);
		} else {
			hotkey.innerHTML = '^' + (++this.hostCount);
		}

		var item = document.createElement('li');
		item.appendChild(initials);
		item.appendChild(tooltip);
		item.appendChild(badge);
		item.appendChild(img);
		item.appendChild(hotkey);

		item.dataset.host = host.url;
		item.setAttribute('server', host.url);
		item.classList.add('instance');

		item.onclick = () => {
			this.emit('click', host.url);
			servers.setActive(host.url);
		};

		this.listElement.appendChild(item);

		serverListSeparator.visible = true;

		var menuItem = {
			label: host.title,
			accelerator: 'CmdOrCtrl+' + this.hostCount,
			position: 'before=server-list-separator',
			id: host.url,
			click: () => {
				var mainWindow = electron.remote.getCurrentWindow();
				mainWindow.show();
				this.emit('click', host.url);
				servers.setActive(host.url);
			}
		};

		windowMenu.submenu.push(menuItem);
		Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
	}

	setImage(hostUrl) {
		const img = this.getByUrl(hostUrl).querySelector('img');
		img.src = `${hostUrl}/assets/favicon.svg?v=${Math.round(Math.random()*10000)}`;
	}

	remove(hostUrl) {
		var el = this.getByUrl(hostUrl);
		if (el) {
			el.remove();

			var index = windowMenu.submenu.findIndex(function(i) {return i.id === hostUrl;});
			windowMenu.submenu.splice(index, 1);
			Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
		}
	}

	getByUrl(hostUrl) {
		return this.listElement.querySelector(`.instance[server="${hostUrl}"]`);
	}

	getActive() {
		return this.listElement.querySelector('.instance.active');
	}

	isActive(hostUrl) {
		return !!this.listElement.querySelector(`.instance.active[server="${hostUrl}"]`);
	}

	setActive(hostUrl) {
		if (this.isActive(hostUrl)) {
			return;
		}

		this.deactiveAll();
		var item = this.getByUrl(hostUrl);
		if (item) {
			item.classList.add('active');
		}
	}

	deactiveAll() {
		var item;
		while (!(item = this.getActive()) === false) {
			item.classList.remove('active');
		}
	}

	setLabel(hostUrl, label) {
		this.listElement.querySelector(`.instance[server="${hostUrl}"] .tooltip`).innerHTML = label;
	}

	setBadge(hostUrl, badge) {
		var item = this.getByUrl(hostUrl);
		var badgeEl = item.querySelector('.badge');

		if (badge !== null && badge !== undefined && badge !== '') {
			item.classList.add('unread');
			if (isNaN(parseInt(badge))) {
				badgeEl.innerHTML = '';
			} else {
				badgeEl.innerHTML = badge;
			}
		} else {
			badge = undefined;
			item.classList.remove('unread');
			badgeEl.innerHTML = '';
		}
		this.emit('badge-setted', hostUrl, badge);
	}

	getGlobalBadge() {
		var count = 0;
		var alert = '';
		var instanceEls = this.listElement.querySelectorAll('li.instance');
		for (var i = instanceEls.length - 1; i >= 0; i--) {
			var instanceEl = instanceEls[i];
			var text = instanceEl.querySelector('.badge').innerHTML;
			if (!isNaN(parseInt(text))) {
				count += parseInt(text);
			}

			if (alert === '' && instanceEl.classList.contains('unread') === true) {
				alert = '•';
			}
		}

		if (count > 0) {
			return String(count);
		} else {
			return alert;
		}
	}

	hide() {
		document.body.classList.add('hide-server-list');
		localStorage.setItem('sidebar-closed', 'true');
		this.emit('hide');
	}

	show() {
		document.body.classList.remove('hide-server-list');
		localStorage.setItem('sidebar-closed', 'false');
		this.emit('show');
	}

	toggle() {
		if (this.isHidden()) {
			this.show();
		} else {
			this.hide();
		}
	}

	isHidden() {
		return localStorage.getItem('sidebar-closed') === 'true';
	}
}

var sidebar = new SideBar();


var selectedInstance = null;
var instanceMenu = electron.remote.Menu.buildFromTemplate([{
	label: 'Reload server',
	click: function() {
		webview.getByUrl(selectedInstance.dataset.host).reload();
	}
}, {
	label: 'Remove server',
	click: function() {
		servers.removeHost(selectedInstance.dataset.host);
	}
}, {
	label: 'Open DevTools',
	click: function() {
		webview.getByUrl(selectedInstance.dataset.host).openDevTools();
	}
}]);

window.addEventListener('contextmenu', function(e) {
	if (e.target.classList.contains('instance') || e.target.parentNode.classList.contains('instance')) {
		e.preventDefault();
		if (e.target.classList.contains('instance')) {
			selectedInstance = e.target;
		} else {
			selectedInstance = e.target.parentNode;
		}

		instanceMenu.popup(electron.remote.getCurrentWindow());
	}
}, false);

var Tray = electron.remote.Tray;
var Menu$2 = electron.remote.Menu;

let mainWindow = electron.remote.getCurrentWindow();

var icons = {
    'win32': {
        dir: 'windows'
    },

    'linux': {
        dir: 'linux'
    },

    'darwin': {
        dir: 'osx',
        icon: 'icon-trayTemplate.png'
    }
};

let _iconTray = path.join(__dirname, 'images', icons[process.platform].dir, icons[process.platform].icon || 'icon-tray.png');
let _iconTrayAlert = path.join(__dirname, 'images', icons[process.platform].dir, icons[process.platform].iconAlert || 'icon-tray-alert.png');

function createAppTray() {
    let _tray = new Tray(_iconTray);
    var contextMenu = Menu$2.buildFromTemplate([{
        label: 'Hide',
        click: function() {
            mainWindow.hide();
        }
    }, {
        label: 'Show',
        click: function() {
            mainWindow.show();
        }
    }, {
        label: 'Quit',
        click: function() {
            electron.remote.app.quit();
        }
    }]);
    _tray.setToolTip(electron.remote.app.getName());
    _tray.setContextMenu(contextMenu);

    if (process.platform === 'darwin' || process.platform === 'win32') {
        _tray.on('double-click', function() {
            mainWindow.show();
        });
    } else {
        let dblClickDelay = 500,
            dblClickTimeoutFct = null;
        _tray.on('click', function() {
            if (!dblClickTimeoutFct) {
                dblClickTimeoutFct = setTimeout(function() {
                    // Single click, do nothing for now
                    dblClickTimeoutFct = null;
                }, dblClickDelay);
            } else {
                clearTimeout(dblClickTimeoutFct);
                dblClickTimeoutFct = null;
                mainWindow.show();
            }
        });
    }

    mainWindow = mainWindow;
    mainWindow.tray = _tray;
}

function showTrayAlert(showAlert, title) {
    if (mainWindow.tray === null || mainWindow.tray === undefined) {
        return;
    }

    mainWindow.flashFrame(showAlert);
    if (showAlert) {
        mainWindow.tray.setImage(_iconTrayAlert);
        if (process.platform === 'darwin') {
            mainWindow.tray.setTitle(title);
        }
    } else {
        mainWindow.tray.setImage(_iconTray);
        if (process.platform === 'darwin') {
            mainWindow.tray.setTitle(title);
        }
    }
}

createAppTray();

var tray = {
    showTrayAlert: showTrayAlert
};

sidebar.on('badge-setted', function() {
    var badge = sidebar.getGlobalBadge();

    if (process.platform === 'darwin') {
        electron.remote.app.dock.setBadge(badge);
    }
    tray.showTrayAlert(!isNaN(parseInt(badge)) && badge > 0, badge);
});

var start = function() {
    var defaultInstance = 'https://demo.rocket.chat';

    // connection check
    function online() {
        document.body.classList.remove('offline');
    }

    function offline() {
        document.body.classList.add('offline');
    }

    if (!navigator.onLine) {
        offline();
    }
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    // end connection check

    var form = document.querySelector('form');
    var hostField = form.querySelector('[name="host"]');
    var button = form.querySelector('[type="submit"]');
    var invalidUrl = form.querySelector('#invalidUrl');

    window.addEventListener('load', function() {
        hostField.focus();
    });

    function validateHost() {
        return new Promise(function(resolve, reject) {
            var execValidation = function() {
                invalidUrl.style.display = 'none';
                hostField.classList.remove('wrong');

                var host = hostField.value.trim();
                host = host.replace(/\/$/, '');
                hostField.value = host;

                if (host.length === 0) {
                    button.value = 'Connect';
                    button.disabled = false;
                    resolve();
                    return;
                }

                button.value = 'Validating...';
                button.disabled = true;

                servers.validateHost(host, 2000).then(function() {
                    button.value = 'Connect';
                    button.disabled = false;
                    resolve();
                }, function(status) {
                    // If the url begins with HTTP, mark as invalid
                    if (/^https?:\/\/.+/.test(host) || status === 'basic-auth') {
                        button.value = 'Invalid url';
                        invalidUrl.style.display = 'block';
                        switch (status) {
                            case 'basic-auth':
                                invalidUrl.innerHTML = 'Auth needed, try <b>username:password@host</b>';
                                break;
                            case 'invalid':
                                invalidUrl.innerHTML = 'No valid server found at the URL';
                                break;
                            case 'timeout':
                                invalidUrl.innerHTML = 'Timeout trying to connect';
                                break;
                        }
                        hostField.classList.add('wrong');
                        reject();
                        return;
                    }

                    // // If the url begins with HTTPS, fallback to HTTP
                    // if (/^https:\/\/.+/.test(host)) {
                    //     hostField.value = host.replace('https://', 'http://');
                    //     return execValidation();
                    // }

                    // If the url isn't localhost, don't have dots and don't have protocol
                    // try as a .rocket.chat subdomain
                    if (!/(^https?:\/\/)|(\.)|(^([^:]+:[^@]+@)?localhost(:\d+)?$)/.test(host)) {
                        hostField.value = `https://${host}.rocket.chat`;
                        return execValidation();
                    }

                    // If the url don't start with protocol try HTTPS
                    if (!/^https?:\/\//.test(host)) {
                        hostField.value = `https://${host}`;
                        return execValidation();
                    }
                });
            };
            execValidation();
        });
    }

    hostField.addEventListener('blur', function() {
        validateHost().then(function() {}, function() {});
    });

    electron.ipcRenderer.on('certificate-reload', function(event, url) {
        hostField.value = url.replace(/\/api\/info$/, '');
        validateHost().then(function() {}, function() {});
    });

    var submit = function() {
        validateHost().then(function() {
            var input = form.querySelector('[name="host"]');
            var url = input.value;

            if (url.length === 0) {
                url = defaultInstance;
            }

            url = servers.addHost(url);
            if (url !== false) {
                sidebar.show();
                servers.setActive(url);
            }

            input.value = '';
        }, function() {});
    };

    hostField.addEventListener('keydown', function(ev) {
        if (ev.which === 13) {
            ev.preventDefault();
            ev.stopPropagation();
            submit();
            return false;
        }
    });

    form.addEventListener('submit', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        submit();
        return false;
    });

    $('.add-server').on('click', function() {
        servers.clearActive();
    });

    servers.restoreActive();
};

window.addEventListener('focus', function() {
    webview.focusActive();
});

var app = electron.remote.app;

Bugsnag.metaData = {
	// platformId: app.process.platform,
	// platformArch: app.process.arch,
	// electronVersion: app.process.versions.electron,
	version: app.getVersion()
	// platformVersion: cordova.platformVersion
	// build: appInfo.build
};

Bugsnag.appVersion = app.getVersion();

window.$ = window.jQuery = require('./vendor/jquery-1.12.0');
start();
}());
//# sourceMappingURL=app.js.map