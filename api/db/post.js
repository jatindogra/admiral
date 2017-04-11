'use strict';

var self = post;
module.exports = self;

var async = require('async');
var _ = require('underscore');
var uuid = require('node-uuid');
var path = require('path');
var fs = require('fs-extra');
var spawn = require('child_process').spawn;

var envHandler = require('../../common/envHandler.js');

function post(req, res) {
  var bag = {
    reqQuery: req.query,
    resBody: {},
    serviceUserTokenEnv: 'SERVICE_USER_TOKEN',
    serviceUserToken: '',
    setServiceUserToken: false
  };

  bag.who = util.format('db|%s', self.name);
  logger.info(bag.who, 'Starting');

  async.series([
      _checkInputParams.bind(null, bag),
      _upsertSystemConfigs.bind(null, bag),
      _generateServiceUserToken.bind(null, bag),
      _setServiceUserToken.bind(null, bag),
      _upsertMasterIntegrations.bind(null, bag),
      _upsertSystemCodes.bind(null, bag)
    ],
    function (err) {
      logger.info(bag.who, 'Completed');
      if (err)
        return respondWithError(res, err);

      sendJSONResponse(res, bag.resBody);
    }
  );
}

function _checkInputParams(bag, next) {
  var who = bag.who + '|' + _checkInputParams.name;
  logger.verbose(who, 'Inside');

  return next();
}

function _upsertSystemConfigs(bag, next) {
  var who = bag.who + '|' + _upsertSystemConfigs.name;
  logger.verbose(who, 'Inside');

  _copyAndRunScript({
      who: who,
      params: {},
      script: '',
      scriptPath: '../../common/scripts/create_sys_configs.sh',
      tmpScriptFilename: '/tmp/systemConfigs.sh',
      scriptEnvs: {
        'CONFIG_DIR': global.config.configDir,
        'SCRIPTS_DIR': global.config.scriptsDir,
        'DBUSERNAME': global.config.dbUsername,
        'DBNAME': global.config.dbName,
        'RELEASE': global.config.release
      }
    },
    function (err) {
      return next(err);
    }
  );
}

function _generateServiceUserToken(bag, next) {
  var who = bag.who + '|' + _generateServiceUserToken.name;
  logger.verbose(who, 'Inside');

  envHandler.get(bag.serviceUserTokenEnv,
    function (err, value) {
      if (err)
        return next(
          new ActErr(who, ActErr.OperationFailed,
            'Cannot get env: ' + bag.serviceUserTokenEnv)
        );

      if (_.isEmpty(value)) {
        logger.debug('Empty service user token, generating a new token');
        bag.serviceUserToken = uuid.v4();
        bag.setServiceUserToken = true;
      } else {
        logger.debug('Found existing service user token');
        bag.serviceUserToken = value;
      }

      return next();
    }
  );
}

function _setServiceUserToken(bag, next) {
  if (!bag.setServiceUserToken) return next();

  var who = bag.who + '|' + _setServiceUserToken.name;
  logger.verbose(who, 'Inside');

  envHandler.put(bag.serviceUserTokenEnv, bag.serviceUserToken,
    function (err) {
      if (err)
        return next(
          new ActErr(who, ActErr.OperationFailed,
            'Cannot set env: ' + bag.serviceUserTokenEnv + ' err: ' + err)
        );

      return next();
    }
  );
}

function _upsertMasterIntegrations(bag, next) {
  var who = bag.who + '|' + _upsertMasterIntegrations.name;
  logger.verbose(who, 'Inside');

  _copyAndRunScript({
      who: who,
      params: {},
      script: '',
      scriptPath: '../../common/scripts/create_master_integrations.sh',
      tmpScriptFilename: '/tmp/masterIntegrations.sh',
      scriptEnvs: {
        'CONFIG_DIR': global.config.configDir,
        'SCRIPTS_DIR': global.config.scriptsDir,
        'DBUSERNAME': global.config.dbUsername,
        'DBNAME': global.config.dbName
      }
    },
    function (err) {
      return next(err);
    }
  );
}

function _upsertSystemCodes(bag, next) {
  var who = bag.who + '|' + _upsertSystemCodes.name;
  logger.verbose(who, 'Inside');

  _copyAndRunScript({
      who: who,
      params: {},
      script: '',
      scriptPath: '../../common/scripts/create_system_codes.sh',
      tmpScriptFilename: '/tmp/systemCodes.sh',
      scriptEnvs: {
        'CONFIG_DIR': global.config.configDir,
        'SCRIPTS_DIR': global.config.scriptsDir,
        'DBUSERNAME': global.config.dbUsername,
        'DBNAME': global.config.dbName
      }
    },
    function (err) {
      return next(err);
    }
  );
}

function _copyAndRunScript(seriesBag, next) {
  var who = seriesBag.who + '|' + _copyAndRunScript.name;
  logger.verbose(who, 'Inside');

  async.series([
      _generateScript.bind(null, seriesBag),
      _writeScriptToFile.bind(null, seriesBag),
      _runScript.bind(null, seriesBag)
    ],
    function (err) {
      fs.remove(seriesBag.tmpScriptFilename,
        function (error) {
          if (error)
            logger.warn(
              util.format('%s, Failed to remove %s %s', who, path, error)
            );
        }
      );
      return next(err);
    }
  );
}

function _generateScript(seriesBag, next) {
  var who = seriesBag.who + '|' + _generateScript.name;
  logger.verbose(who, 'Inside');

  var script = '';
  //attach header
  script = script.concat(
    __applyTemplate('../../lib/_logger.sh', seriesBag.params));

  script = script.concat(
    __applyTemplate(seriesBag.scriptPath, seriesBag.params));

  seriesBag.script = script;
  return next();
}

function _writeScriptToFile(seriesBag, next) {
  var who = seriesBag.who + '|' + _writeScriptToFile.name;
  logger.debug(who, 'Inside');

  fs.writeFile(seriesBag.tmpScriptFilename, seriesBag.script,
    function (err) {
      if (err) {
        var msg = util.format('%s, Failed with err:%s', who, err);
        return next(
          new ActErr(who, ActErr.OperationFailed, msg)
        );
      }
      fs.chmodSync(seriesBag.tmpScriptFilename, '755');
      return next();
    }
  );
}

function _runScript(seriesBag, next) {
  var who = seriesBag.who + '|' + _runScript.name;
  logger.verbose(who, 'Inside');

  var exec = spawn('/bin/bash',
    ['-c', seriesBag.tmpScriptFilename],
    {
      cwd: '/',
      env: seriesBag.scriptEnvs
    }
  );

  exec.stdout.on('data',
    function (data)  {
      console.log(data.toString());
    }
  );

  exec.stderr.on('data',
    function (data)  {
      console.log(data.toString());
    }
  );

  exec.on('close',
    function (exitCode)  {
      return next(exitCode);
    }
  );
}

//local function to apply vars to template
function __applyTemplate(fileName, dataObj) {
  var filePath = path.join(__dirname, fileName);
  var fileContent = fs.readFileSync(filePath).toString();
  var template = _.template(fileContent);

  return template({obj: dataObj});
}