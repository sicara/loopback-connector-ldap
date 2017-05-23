
var g = require('strong-globalize')();
var fs = require('fs');
var Connector = require('loopback-connector').Connector;
var debug = require('debug')('loopback:connector:ldap');
var ldapclient = require('ldapjs');
var util = require('util');

  /**
   * Initialize the LDAP Connector for the given data source
   * @param {DataSource} dataSource The data source instance
   * @param {Function} [callback] The callback function
   */
  exports.initialize = function initializeDataSource(dataSource, callback) {
    if (!ldapclient) {
      return;
    }
    // Add check to settings
    var settings = dataSource.settings;
    var tlsOptions;

    if (settings.tlsOptions) {
      tlsOptions = {};

      if (settings.tlsOptions.caFile) {
        tlsOptions.ca = [fs.readFileSync(settings.tlsOptions.caFile)];
      }

      if (settings.tlsOptions.checkServerIdentity) {
        tlsOptions.checkServerIdentity = function (host, cert) {
          return undefined;
        }
      }
    }

    var clientSettings = {
      url: settings.url,
      tlsOptions: tlsOptions,
    };

    dataSource.ldapClient = ldapclient.createClient(clientSettings);
    dataSource.ldapClient.bind(settings.bindDn, settings.bindPassword, function(err) {
        if(err){
          g.error("LDAP error: " + err.message);
        } else{
          debug("LDAP Connection SUCCESSFUL");
        }
    });

    dataSource.connector = new LDAPConnector(settings,dataSource);
    process.nextTick(function () {
      callback && callback();
    });
  };

  /**
   * The constructor for LDAP connector
   * @param {Object} settings The settings object
   * @param {DataSource} dataSource The data source instance
   * @constructor
   */
  function LDAPConnector(settings, dataSource){
     Connector.call(this,'ldap',settings);
     this.dataSource = dataSource;
     this.ldapClient = dataSource.ldapClient;
     debug('Connector settings' , settings);
  };

  util.inherits(LDAPConnector, Connector);


  LDAPConnector.prototype.connect = function(callback){

     var self = this;
     console.log("Binding with the LDAP");
     self.ldapClient.bind(settings.bindDn, settings.bindPassword, function(err) {
        if(err){
          console.log(err);
        }else{
          console.log("LDAP Connection SUCCESFUL");
        }


     });
    process.nextTick(function () {
      callback && callback();
    });

  };

  LDAPConnector.prototype.disconnect = function(callback){

    var self = this;
    self.ldapClient.unbind(function(err){
         if(err){
            g.error("LDAP disconnection FAILED");
         }
    });
    process.nextTick(function () {
      callback && callback();
    });

  };


  LDAPConnector.prototype.ping = function(callback) {
    console.log("Calling ping");
  };

  LDAPConnector.prototype.execute = function(model, command) {
    // ...
  };

  LDAPConnector.prototype.LDAPtoModel =function(ldapEntry,model){
    var self = this;
    var modelMapping = self.settings.modelMapping[model]['mapping'];
    if(!modelMapping) {
      g.error(" Couldn't find a model mapping for "+model);
    }
    var modelInstance = {};

    for(var key in modelMapping){
      if(modelMapping[key] && ldapEntry[modelMapping[key]]){
            modelInstance[key] = ldapEntry[modelMapping[key]];
      }
    }
    return modelInstance;
  }

  LDAPConnector.prototype.modeltoLDAPFilter =function(filter,model) {
    var self = this;
    var modelMapping = self.settings.modelMapping[model]['mapping'];

    if(!modelMapping) {
      g.error(" Couldn't find a model mapping for "+model);
    }
    var ldapInstance = "";

    for(var key in filter){
      if(modelMapping[key] && filter[key]){
           ldapInstance+="("+ modelMapping[key]+"="+ filter[key]+")";
      }
      else {
        g.error(`Unknown key '${key}' in ${model} mapping for LDAP`)
      }
    }
    return ldapInstance;
 }


 LDAPConnector.prototype.count = function(model, where, options, callback) {

    var self = this;
    // Building filter
    var searchFilter={};
    if(where){
      searchFilter=self.modeltoLDAPFilter(where,model);
    }else{
      searchFilter=self.settings.searchBaseFilter;
    }
    var opts = {
       filter: searchFilter,
       scope :'sub',
       attributes: self.settings.modelMapping.id,
    };

    self.ldapClient.search(self.settings.searchBase, opts ,function(err,res){
        var queryResult = [];

        res.on('searchEntry', function(entry) {
          queryResult.push(self.LDAPtoModel(entry.object,model));
        });

        res.on('searchReference', function(referral) {
          console.log('referral: ' + referral.uris.join());
        });

        res.on('error', function(err) {
          console.error('error: ' + err.message);
          callback(null, -1);
        });

        res.on('end', function(result) {
          console.log('status: ' + result.status);
          callback(null, queryResult.length);
        });

    });

 };


  LDAPConnector.prototype.modeltoLDAPEntry = function(data, model){
      var self = this;
      var modelMapping = self.settings.modelMapping[model]['mapping'];
      if(!modelMapping) {
        g.error(" Couldn't find a model mapping for "+model);
      }

      var ldapEntry = {};
      for(var key in modelMapping){
        if(modelMapping[key] && data[key]){
          ldapEntry[modelMapping[key]] = data[key];
        }
      }

      if (include_objectclass) {
        ldapEntry['objectclass'] = self.settings.modelMapping[model]['objectclass'];
      }

      return ldapEntry;
  }

  LDAPConnector.prototype.modeltoLDAPEntryChanges = function(data, model){
      var self = this;
      var modelMapping = self.settings.modelMapping[model]['mapping'];
      if(!modelMapping) {
        g.error(" Couldn't find a model mapping for "+model);
      }

      var ldapChanges = [];
      for(var key in modelMapping){
        if(modelMapping[key] && data[key]){
          ldapChanges.push(new ldapclient.Change({
            operation: 'replace',
            modification: {
              [modelMapping[key]]: data[key]
            }
          }));
        }
      }

      return ldapChanges;
  }

  LDAPConnector.prototype.create = function (model, data, callback) {
    var self = this;
    var ldapEntry = this.modeltoLDAPEntry(data, model);

    var searchBase = self.settings.modelMapping[model].searchBase;
    self.ldapClient.add(`cn=${ldapEntry['cn']},${searchBase}`, ldapEntry , function(err) {
      if(err){
        g.error("Could Not add new Entry: "+ err);
        callback("Could Not add new Entry", null);
      } else{
        self.ldapClient.search(`cn=${ldapEntry['cn']},${searchBase}`, {scope :'sub' , attributes: ['entryUUID'] }, function(err,res){
            var newEntry = [];

            res.on('searchEntry', function(entry) {
              newEntry = self.LDAPtoModel(entry.object,model);
            });

            res.on('searchReference', function(referral) {
              console.log('referral: ' + referral.uris.join());
            });
            res.on('error', function(err) {
              console.error('error: ' + err.message);
            });
            res.on('end', function(result) {
              console.log('status: ' + result.status);
              callback(null, newEntry.id );
            });
        });
      }
    });
  };

  LDAPConnector.prototype.updateAttributes = function updateAttrs(model, id, data, options, callback) {
    var self = this;
    var ldapChanges = this.modeltoLDAPEntryChanges(data, model);

    var searchBase = self.settings.modelMapping[model].searchBase;

    self.ldapClient.modify(`'${searchBase}' '(entryUUID=${id})'`, ldapChanges, function(err) {
      if(err){
        g.error("Could Not modify Entry: "+ err);
        return callback("Could Not add new Entry", null);
      } else{
        return callback(null, id );
      }
    });
  };


  LDAPConnector.prototype.all = function(model, filter, callback) {
    debug("Using filter" + JSON.stringify(filter));

    var self = this;
    // Building filter
    var searchFilter={};
    if(filter['where']){
      searchFilter=self.modeltoLDAPFilter(filter['where'],model);
    }else{
      searchFilter=self.settings.searchBaseFilter;
    }

    var modelMapping = self.settings.modelMapping[model]['mapping'];
    if(!modelMapping) {
      g.error(" Couldn't find a model mapping for "+model);
    }
    var requiredAttributes = [];
    for(var key in modelMapping){
      requiredAttributes.push(modelMapping[key]);
    }

    var opts = {
       filter: searchFilter,
       scope :'sub',
       attributes: requiredAttributes,
    };

    self.ldapClient.search(self.settings.modelMapping[model].searchBase, opts ,function(err,res){
        var queryResult = [];

        res.on('searchEntry', function(entry) {
          queryResult.push(self.LDAPtoModel(entry.object,model));
        });
        res.on('searchReference', function(referral) {
          console.log('referral: ' + referral.uris.join());
        });
        res.on('error', function(err) {
          console.error('error: ' + err.message);
        });
        res.on('end', function(result) {
          // console.log('status: ' + result.status + queryResult);
          callback(null, queryResult);
        });
    });

  };
