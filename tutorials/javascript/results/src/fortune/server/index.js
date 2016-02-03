var vanadium = require('vanadium');
var FortuneService = require('../service');

// Define the Vanadium configuration for this app.
var config = {
  logLevel: vanadium.vlog.levels.INFO,
  appName: 'Fortune Server'
};

// Setup Vanadium and serve the Fortune service.
vanadium.init(config, function(err, runtime) {
  if (err) {
    return displayError(err);
  }
  runtime.on('crash', displayError);

  // Create and serve the Fortune service.
  var service = new FortuneService();
  var serviceName = getDefaultServiceName(runtime.accountName);
  runtime.newServer(serviceName, service, function(err) {
    if (err) {
      displayError(err);
    }
  });

  // Initialize the UI (see fortune-server.html).
  uiInit(service, serviceName);
});
function getDefaultServiceName(accountName) {
  var homeDir = accountName.replace(/^dev.v.io:u:/, 'users/').replace(vanadium.security.ChainSeparator.val, '/');
  return homeDir + '/tutorial/fortune';
}
