// disconnect any meteor server
if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1')
  Meteor.disconnect();

// Make sure the example contract code is up to date
var contractSource = localStorage.getItem('contractSource');

if (
  contractSource && // repopulate placeholder contract if:
  (contractSource === '' || // source is empty or
    (contractSource.indexOf(Helpers.getDefaultContractExample(true)) !== -1 && // default 'MyContract' exists and
      contractSource.split('contract ').length - 1 === 1))
) {
  // 'MyContract' is the only contract
  localStorage.setItem('contractSource', Helpers.getDefaultContractExample());
}

Meteor.Spinner.options = {
  lines: 17, // The number of lines to draw
  length: 0, // The length of each line
  width: 4, // The line thickness
  radius: 16, // The radius of the inner circle
  corners: 1, // Corner roundness (0..1)
  rotate: 0, // The rotation offset
  direction: 1, // 1: clockwise, -1: counterclockwise
  color: '#000', // #rgb or #rrggbb or array of colors
  speed: 1.7, // Rounds per second
  trail: 49, // Afterglow percentage
  shadow: false, // Whether to render a shadow
  hwaccel: false, // Whether to use hardware acceleration
  className: 'spinner', // The CSS class to assign to the spinner
  zIndex: 10, // The z-index (defaults to 2000000000)
  top: '50%', // Top position relative to parent
  left: '50%' // Left position relative to parent
};

let initSync = false;
var checkSync = function() {
  // Stop app operation, when the node is syncing
  web3.eth
    .isSyncing()
    .then(function(syncing) {
      if (syncing === true) {
        if (initSync) return;
        initSync = true;
        console.time('nodeRestarted');
        console.log('Node started syncing, stopping app operation');
        web3.reset(true);

        // clear observers
        _.each(collectionObservers, function(observer) {
          if (observer) {
            observer.stop();
          }
        });
        collectionObservers = [];
      } else if (_.isObject(syncing)) {
        syncing.progress = Math.floor(
          ((syncing.currentBlock - syncing.startingBlock) /
            (syncing.highestBlock - syncing.startingBlock)) *
            100
        );
        syncing.blockDiff = numeral(
          syncing.highestBlock - syncing.currentBlock
        ).format('0,0');

        Session.set('syncing', syncing);
      } else {
        console.timeEnd('nodeRestarted');
        console.log('Restart app operation again');

        Session.set('syncing', false);

        // re-gain app operation
        connectToNode();
      }
    })
    .catch(function(error) {
      console.log('Error: ', error);
      if (
        error
          .toString()
          .toLowerCase()
          .includes('connection not open')
      ) {
        // retry in 2 seconds
        Meteor.setTimeout(checkSync, 2000);
      } else {
        // retry
        checkSync();
      }
    });
};

var showModal = function() {
  // make sure the modal is rendered after all routes are executed
  Meteor.setTimeout(function() {
    // if in mist, tell to start geth, otherwise start with RPC
    var gethRPC = window.mist
      ? 'geth'
      : 'geth --rpc --ws --wsorigins "' +
        window.location.protocol +
        '//' +
        window.location.host +
        '"';

    EthElements.Modal.question(
      {
        text: new Spacebars.SafeString(
          TAPi18n.__(
            'wallet.app.texts.connectionError' +
              (window.mist ? 'Mist' : 'Browser'),
            { node: gethRPC }
          )
        ),
        ok: function() {
          Tracker.afterFlush(function() {
            connect();
          });
        }
      },
      {
        closeable: false
      }
    );
  }, 600);
};

var connect = function() {
  web3.eth.net
    .isListening()
    .then(function(isListening) {
      if (isListening) {
        // only start app operation, when the node is not syncing (or the eth_syncing property doesn't exists)
        web3.eth
          .isSyncing()
          .then(function(syncing) {
            if (!syncing) {
              connectToNode();
            } else {
              EthAccounts.init();
            }
          })
          .catch(function(error) {
            console.log('Error: ', error);
            connect(); // retry
          });

        bravePasswordFlow();
        globalReady.set(true);
      } else {
        console.log('Could not connect to geth, retrying in 3 seconds');
        Meteor.setTimeout(connect, 3000);
      }
    })
    .catch(function(error) {
      console.log('Error: ', error);
      if (
        error
          .toString()
          .toLowerCase()
          .includes('connection not open')
      ) {
        console.log('Could not connect to geth, retrying in 3 seconds');
        Meteor.setTimeout(connect, 3000);
      } else {
        // retry
        connect();
      }
    });
};

window.batAddress = new ReactiveVar();
if (window.chrome && window.chrome.ipcRenderer) {
  window.chrome.ipcRenderer.on(
    'popup-bat-balance',
    (e, amount, walletAddress) => {
      window.batAddress.set(walletAddress);
    }
  );

  function updateBATAddress() {
    if (!window.batAddress.get()) {
      window.chrome.ipcRenderer.send('get-popup-bat-balance');
      setTimeout(updateBATAddress, 1000);
    }
  }
  updateBATAddress();
}

globalReady = new ReactiveVar(false);
FlowRouter.go('/');
Meteor.startup(function() {
  // delay so we make sure the data is already loaded from the indexedDB
  // TODO improve persistent-minimongo2 ?
  Meteor.setTimeout(function() {
    connect();
    checkSync();
    Meteor.setInterval(checkSync, 2000);
  }, 500);

  Tracker.nonreactive(function() {
    function observeCb() {
      if (!window.chrome || !window.chrome.ipcRenderer) return;
      const wallets = EthAccounts.find(
        {},
        { fields: { address: 1, name: 1 } }
      ).fetch();
      window.chrome.ipcRenderer.send(
        'eth-wallet-wallets',
        JSON.stringify(wallets)
      );
    }

    EthAccounts.find().observe({
      added: observeCb,
      changed: observeCb,
      removed: observeCb
    });
  });
});
