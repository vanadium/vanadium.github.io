var vanadium = require('vanadium');

// Define HelloService and the hello() method.
function HelloService() {}

HelloService.prototype.hello = function(ctx, serverCall, greeting) {
  displayHello(greeting);
};

// Initialize Vanadium runtime.
vanadium.init(function(err, runtime) {
  if (err) {
    showStatus('Initialization error: ' + err);
    return;
  }
  showStatus('Initialized');
  runtime.on('crash', function(err) {
    showStatus('The runtime has crashed unexpectedly and the page must be reloaded.');
  });

  setupServer(runtime);
  setupClient(runtime);
});

// Setup the server.
function setupServer(runtime) {
  // Create a server and serve the HelloService.
  var serviceName = getLocalPeerName(runtime.accountName);
  runtime.newServer(serviceName, new HelloService(), function(err) {
    if (err) {
      showServerStatus('Failed to serve ' + serviceName + ': ' + err);
      return;
    }
    showServerStatus('Serving');
    // HelloService is now served.
  });
}

// Setup the client.
function setupClient(runtime) {
  // Create a client and bind to the service.
  var client = runtime.getClient();
  var ctx = runtime.getContext();

  var serviceName = getRemotePeerName(runtime.accountName);
  showClientStatus('Binding');
  client.bindTo(ctx, serviceName, function(err, helloService) {
    if (err) {
      showClientStatus('Failed to bind to ' + serviceName + ': ' + err);
      return;
    }
    showClientStatus('Ready');

    registerButtonHandler(function(greeting) {
      showClientStatus('Calling');
      // Call hello() on the service.
      helloService.hello(ctx, greeting, function(err) {
        if (err) {
          showClientStatus('Error invoking hello(): ' + err);
          return;
        }
        showClientStatus('Ready');
      });
    });
  });
}

// Get the local and remote names.
function getLocalPeerName(accountName) {
  var homeDir = accountName.replace(/^dev.v.io:u:/, 'users/').replace(vanadium.security.ChainSeparator.val, '/');
  var hash = window.location.hash;
  return homeDir + '/tutorial/hello' + hash;
}
function getRemotePeerName(accountName) {
  var localPeer = getLocalPeerName(accountName);
  var splitPeer = localPeer.split('#');
  if (splitPeer[1] == 'A') {
    splitPeer[1] = 'B';
  } else {
    splitPeer[1] = 'A';
  }
  return splitPeer.join('#');
}

// Manipulate the html page.
function displayHello(greeting) {
  var li = document.createElement('li');
  li.textContent = greeting;
  document.getElementById('receivedhellos').appendChild(li);
}
function registerButtonHandler(fn) {
  document.getElementById('hellobutton').addEventListener('click', function() {
    var greeting = document.getElementById('hellotext').value;
    fn(greeting);
  });
}
function showClientStatus(text) {
  document.getElementById('clientstatus').textContent = text;
}
function showServerStatus(text) {
  document.getElementById('serverstatus').textContent = text;
}
function showStatus(text) {
  showClientStatus(text);
  showServerStatus(text);
}
