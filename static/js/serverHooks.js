'use strict';

/**
 * Server-side hooks
 *
 * @see {@link http://etherpad.org/doc/v1.5.7/#index_server_side_hooks}
 */

var eejs = require('ep_etherpad-lite/node/eejs/');
var Changeset = require('ep_etherpad-lite/static/js/Changeset');
var settings = require('ep_etherpad-lite/node/utils/Settings');
var Busboy = require('busboy');
var StreamUpload = require('stream_upload');
var uuid = require('uuid');
var path = require('path');
var fs = require('fs');

/**
 * ClientVars hook
 *
 * Exposes plugin settings from settings.json to client code inside clientVars variable to be accessed from client side hooks
 *
 * @param {string} hook_name Hook name ("clientVars").
 * @param {object} args Object containing the arguments passed to hook. {pad: {object}}
 * @param {function} cb Callback
 *
 * @returns {*} callback
 *
 * @see {@link http://etherpad.org/doc/v1.5.7/#index_clientvars}
 */
exports.clientVars = function (hook_name, args, cb) {
    var pluginSettings = {};
    var keys = Object.keys(settings.ep_image_upload);
    keys.forEach(function (key) {
        if (key !== 'storage') {
            pluginSettings[key] = settings.ep_image_upload[key];
        }
    });

    if (!pluginSettings) {
        console.warn(hook_name, 'ep_image_upload settings not found. The settings can be specified in EP settings.json.');

        return cb();
    }

    return cb({ep_image_upload: pluginSettings});
};

exports.eejsBlock_editbarMenuRight = function (hook_name, args, cb) {
    var eejsContent = eejs.require('ep_image_upload/templates/editBarButtons.ejs');
    args.content += eejsContent;

    return cb();
};

exports.eejsBlock_body = function (hook_name, args, cb) {
    var modal = eejs.require('ep_image_upload/templates/modal.ejs', {}, module);
    args.content += modal;

    return cb();
};

exports.eejsBlock_styles = function (hook_name, args, cb) {
    var style = eejs.require('ep_image_upload/templates/styles.ejs', {}, module);
    args.content += style;

    return cb();
};

exports.padInitToolbar = function (hook_name, args) {
    var toolbar = args.toolbar;
    var addImageButton = toolbar.button({
        command: 'addImage',
        class: 'buttonicon ep_image_upload image_upload'
    });

    toolbar.registerButton('addImage', addImageButton);
};

var _analyzeLine = function (alineAttrs, apool) {
    var image = null;
    if (alineAttrs) {
        var opIter = Changeset.opIterator(alineAttrs);
        if (opIter.hasNext()) {
            var op = opIter.next();
            image = Changeset.opAttributeValue(op, 'img', apool);
        }
    }

    return image;
};

exports.getLineHTMLForExport = function (hook, context) {
    var image = _analyzeLine(context.attribLine, context.apool);
    if (image) {
        context.lineContent = image;
    }
};

var drainStream = function (stream) {
    stream.on('readable', stream.read.bind(stream));
};

exports.expressCreateServer = function (hook_name, context) {
    context.app.post('/p/:padId/pluginfw/ep_image_upload/upload', function (req, res, next) {
        var padId = req.params.padId;
        var imageUpload = new StreamUpload({
            extensions: settings.ep_image_upload.fileTypes,
            maxSize: settings.ep_image_upload.maxFileSize,
            baseFolder: settings.ep_image_upload.storage.baseFolder,
            storage: settings.ep_image_upload.storage
        });
        var storageConfig = settings.ep_image_upload.storage;

        if (storageConfig) {
            try {
                var busboy = new Busboy({
                    headers: req.headers,
                    limits: {
                        fileSize: Infinity
                    }
                });
            } catch (error) {
                console.log('error', error);
                return next(error);
            }
            
            var isDone;
            var done = function (error) {
                if (isDone) return;
                isDone = true;
          
                req.unpipe(busboy);
                drainStream(req);
                busboy.removeAllListeners();

                return res.status(error.statusCode || 500).json(error);
            };
            var uploadResult;
            var newFileName = uuid.v4();
            busboy.on('file', function (fieldname, file, filename, encoding, mimetype) {
                var savedFilename = path.join(padId, newFileName + path.extname(filename));
                file.on('error', function (error) {
                    busboy.emit('error', error);
                });

                uploadResult = imageUpload
                    .upload(file, {type: mimetype, filename: savedFilename});
            });

            busboy.on('error', done);

            busboy.on('finish', function () {
                if (uploadResult) {
                    uploadResult
                        .then(function (data) {
                            return res.status(201).json(data);
                        })
                        .catch(function (err) {
                            return res.status(500).json(err);
                        });
                }
                
            });
            req.pipe(busboy);
        }

        
    });
