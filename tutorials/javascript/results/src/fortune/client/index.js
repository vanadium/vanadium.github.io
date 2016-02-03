var vanadium = require('vanadium');

// Define the Vanadium configuration for this app.
var config = {
  logLevel: vanadium.vlog.levels.INFO,
  appName: 'Fortune Client'
};

vanadium.init(config, function(err, runtime) {
  if (err) {
    displayError(err);
    return;
  }

  // Get runtime context and client.
  var context = runtime.getContext();
  var client = runtime.getClient();

  // Set default service name.
  var defaultName = getDefaultServiceName(runtime.accountName);
  setServiceName(defaultName);

  // Listen for button presses.
  document.getElementById('get-button').addEventListener('click', getFortune);
  document.getElementById('add-button').addEventListener('click', addFortune);

  // Adds a fortune to the fortune teller.
  function addFortune() {
    updateStatus('Adding ' + getEnteredFortune() + '...');
    client.bindTo(context, getServiceName(), function(err, s) {
      if (err) {
        displayError(err);
        return;
      }

      s.add(context, getEnteredFortune(), function(err) {
        if (err) {
          displayError(err);
          return;
        }
        updateStatus('Done!');
      });
    });
  }

  // Gets a random fortune from the fortune teller.
  function getFortune() {
    updateStatus('Getting random fortune...');
    client.bindTo(context, getServiceName(), function(err, s) {
      if (err) {
        displayError(err);
        return;
      }

      s.get(context, function(err, randomFortune) {
        if (err) {
          displayError(err);
          return;
        }

        displayFortune(randomFortune);
        updateStatus('Done!');
      });
    });
  }
});
function getDefaultServiceName(accountName) {
  var homeDir = accountName.replace(/^dev.v.io:u:/, 'users/').replace(vanadium.security.ChainSeparator.val, '/');
  return homeDir + '/tutorial/fortune';
}
