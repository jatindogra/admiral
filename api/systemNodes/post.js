'use strict';

var self = post;
module.exports = self;

var async = require('async');
var mongoose = require('mongoose');
var _ = require('underscore');

var APIAdapter = require('../../common/APIAdapter.js');

function post(req, res) {
  var bag = {
    reqBody: req.body,
    resBody: {},
    apiAdapter: new APIAdapter(req.headers.authorization.split(' ')[1]),
    friendlyName: null,
    execImage: null
  };

  bag.who = util.format('systemNodes|%s', self.name);
  logger.info(bag.who, 'Starting');

  async.series(
    [
      _checkInputParams.bind(null, bag),
      _getSystemCluster.bind(null, bag),
      _getRuntimeTemplates.bind(null, bag),
      _getAdmiralEnv.bind(null, bag),
      _post.bind(null, bag),
      _getSystemNode.bind(null, bag)
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

  if (!bag.reqBody)
    return next(
      new ActErr(who, ActErr.BodyNotFound, 'Missing body')
    );

  if (!bag.reqBody.friendlyName)
    return next(
      new ActErr(who, ActErr.DataNotFound, 'Missing body data :friendlyName')
    );
  bag.friendlyName = bag.reqBody.friendlyName;

  return next();
}

function _getSystemCluster(bag, next) {
  var who = bag.who + '|' + _getSystemCluster.name;
  logger.verbose(who, 'Inside');

  var query = '';
  bag.apiAdapter.getSystemClusters(query,
    function (err, systemClusters) {
      if (err)
        return next(
          new ActErr(who, err.id,
            'getSystemClusters failed for query: ' + query +
            ' with error: ' + err.message)
        );

      bag.systemCluster = _.findWhere(
        systemClusters, { id: parseInt(bag.reqBody.systemClusterId) }
      );

      if (_.isEmpty(bag.systemCluster))
        return next(
          new ActErr(who, ActErr.DBEntityNotFound,
            'System Cluster not found for id: ' + bag.reqBody.systemClusterId)
        );

      return next();
    }
  );
}

function _getRuntimeTemplates(bag, next) {

  var who = bag.who + '|' + _getRuntimeTemplates.name;
  logger.verbose(who, 'Inside');

  bag.apiAdapter.getRuntimeTemplates(
    function (err, runtimeTemplates) {
      if (err)
        return next(who, ActErr.OperationFailed,
          'Failed to get runtimeTemplates:' + util.inspect(err));

      bag.systemClusterRuntimeTemplate = _.findWhere(
        runtimeTemplates, { id: bag.systemCluster.runtimeTemplateId }
      );
      return next();
    }
  );
}

function _getAdmiralEnv(bag, next) {
  var who = bag.who + '|' + _getAdmiralEnv.name;
  logger.verbose(who, 'Inside');

  bag.apiAdapter.getAdmiralEnv(
    function (err, admiralEnv) {
      if (err)
        return next(
          new ActErr(who, ActErr.OperationFailed,
            'Failed to get admiralEnv : ' + util.inspect(err))
        );

      bag.releaseVersion = admiralEnv.RELEASE;
      return next();
    }
  );
}

function _post(bag, next) {
  var who = bag.who + '|' + _post.name;
  logger.verbose(who, 'Inside');

  bag.systemNodeId = mongoose.Types.ObjectId().toString();

  var newSystemNode = {
    id: bag.systemNodeId,
    friendlyName: bag.friendlyName,
    sshPort: bag.reqBody.sshPort,
    sshUser: 'shippable',
    isShippableInitialized: !!bag.reqBody.isShippableInitialized,
    initScript: bag.reqBody.initScript,
    sourceId: bag.reqBody.sourceId,
    location: bag.reqBody.location,
    nodeTypeCode: bag.reqBody.nodeTypeCode,
    execImage:  util.format(
      '%s/%s:%s', bag.systemClusterRuntimeTemplate.drydockOrg,
      bag.systemClusterRuntimeTemplate.reqProcImage,
      bag.releaseVersion),
    systemClusterId: bag.reqBody.systemClusterId,
    createdBy: '54188262bc4d591ba438d62a',
    updatedBy: '54188262bc4d591ba438d62a'
  };

  var insertColumns = [];
  var insertValues = [];

  _.each(_.keys(newSystemNode), function (key) {
    if (_.isUndefined(newSystemNode[key])) return;
    if (_.isString(newSystemNode[key]) || _.isObject(newSystemNode[key]))
      insertValues.push(util.format('\'%s\'', newSystemNode[key]));
    else
      insertValues.push(util.format('%s', newSystemNode[key]));
    insertColumns.push(util.format('"%s"', key));
  });

  var insertStatement = util.format('INSERT INTO "systemNodes" (%s' +
    ', "statusLastUpdatedAt", "createdAt", "updatedAt") values (%s, ' +
    'CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
    insertColumns.join(','), insertValues.join(','));

  global.config.client.query(insertStatement,
    function (err) {
      if (err)
        return next(
          new ActErr(who, ActErr.DBOperationFailed,
            'Failed to create systemNode with error: ' + util.inspect(err))
        );

      return next();
    }
  );
}

function _getSystemNode(bag, next) {
  var who = bag.who + '|' + _getSystemNode.name;
  logger.verbose(who, 'Inside');

  var query = util.format('SELECT * FROM "systemNodes" WHERE id=\'%s\'',
    bag.systemNodeId);

  global.config.client.query(query,
    function (err, systemNodes) {
      if (err)
        return next(
          new ActErr(who, ActErr.DBOperationFailed,
            'Failed to get systemNode with error: ' + util.inspect(err))
        );

      if (_.isEmpty(systemNodes.rows))
        return next(
          new ActErr(who, ActErr.DBEntityNotFound,
            'systemNode not found for id: ' + bag.systemNodeId)
        );

      logger.debug('Found systemNode ' + bag.systemNodeId);

      bag.resBody = systemNodes.rows[0];
      return next();
    }
  );
}
