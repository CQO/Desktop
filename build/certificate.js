(function () {'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var electron = require('electron');
var path = _interopDefault(require('path'));
var fs = _interopDefault(require('fs'));
var url = _interopDefault(require('url'));

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

module.exports = certificateStore;
}());
//# sourceMappingURL=certificate.js.map