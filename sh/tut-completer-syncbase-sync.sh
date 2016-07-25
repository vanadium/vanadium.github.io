#
# Script @completer from content/tutorials/setup.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'envVars' (1/1 in completer) of content/tutorials/setup.md"
####
# If JIRI_ROOT or VANADIUM_RELEASE are not defined, set them to the default values
# from the installation instructions and hope for the best.

[ -z "${JIRI_ROOT}" ] && export JIRI_ROOT=${HOME}/vanadium
[ -z "${VANADIUM_RELEASE}" ] && export VANADIUM_RELEASE=${JIRI_ROOT}/release/go

# All files created by the tutorial will be placed in $V_TUT. It is a disposable
# workspace, easy to recreate.
export V_TUT=${V_TUT-$HOME/v23_tutorial}

# V_BIN is the location for Vanadium binaries.
export V_BIN=${VANADIUM_RELEASE}/bin

# Include the Vanadium binaries in the PATH.
export PATH=${V_BIN}:${PATH}

# For the shell doing the tutorials, GOPATH must include both Vanadium and the
# code created as a result of doing the tutorials. To avoid trouble with
# accumulation, $GOPATH is intentionally omitted from the right hand side (any
# existing value is ignored).
if [ -z "${V23_GOPATH}" ]; then
  export V23_GOPATH=`${JIRI_ROOT}/.jiri_root/scripts/jiri go env GOPATH`
fi
export GOPATH=${V_TUT}:${V23_GOPATH}

# HISTCONTROL set as follows excludes long file creation commands used in
# tutorials from your shell history.
HISTCONTROL=ignorespace

# A convenience for killing tutorial processes
function kill_tut_process() {
  eval local pid=\$$1
  if [ -n "$pid" ]; then
    kill $pid || true
    wait $pid || true
    eval unset $1
  fi
}
#----------------------------------------------------------------------#  End 1

 bash -euo pipefail <<'HANDLED_SCRIPT'
function handledTrouble() {
  echo " "
  echo "Unable to continue!"
  exit 1
}
trap handledTrouble INT TERM
#
# Script @completer from content/tutorials/setup.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'envVars' (1/1 in completer) of content/tutorials/setup.md"
####
# If JIRI_ROOT or VANADIUM_RELEASE are not defined, set them to the default values
# from the installation instructions and hope for the best.

[ -z "${JIRI_ROOT}" ] && export JIRI_ROOT=${HOME}/vanadium
[ -z "${VANADIUM_RELEASE}" ] && export VANADIUM_RELEASE=${JIRI_ROOT}/release/go

# All files created by the tutorial will be placed in $V_TUT. It is a disposable
# workspace, easy to recreate.
export V_TUT=${V_TUT-$HOME/v23_tutorial}

# V_BIN is the location for Vanadium binaries.
export V_BIN=${VANADIUM_RELEASE}/bin

# Include the Vanadium binaries in the PATH.
export PATH=${V_BIN}:${PATH}

# For the shell doing the tutorials, GOPATH must include both Vanadium and the
# code created as a result of doing the tutorials. To avoid trouble with
# accumulation, $GOPATH is intentionally omitted from the right hand side (any
# existing value is ignored).
if [ -z "${V23_GOPATH}" ]; then
  export V23_GOPATH=`${JIRI_ROOT}/.jiri_root/scripts/jiri go env GOPATH`
fi
export GOPATH=${V_TUT}:${V23_GOPATH}

# HISTCONTROL set as follows excludes long file creation commands used in
# tutorials from your shell history.
HISTCONTROL=ignorespace

# A convenience for killing tutorial processes
function kill_tut_process() {
  eval local pid=\$$1
  if [ -n "$pid" ]; then
    kill $pid || true
    wait $pid || true
    eval unset $1
  fi
}
#----------------------------------------------------------------------#  End 1

#
# Script @completer from content/tutorials/checkup.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'checkTutorialAssets' (1/1 in completer) of content/tutorials/checkup.md"
####
function bad_vanadium() {
  echo '
  Per https://vanadium.github.io/installation/, either

    export JIRI_ROOT={your installation directory}

  or do a fresh install.';
  exit 1;
}

[ -z "$VANADIUM_RELEASE" ] && { echo 'The environment variable VANADIUM_RELEASE is not defined.'; bad_vanadium; }

[ -x "$VANADIUM_RELEASE/bin/principal" ] || { echo 'The file $VANADIUM_RELEASE/bin/principal does not exist or is not executable.'; bad_vanadium; }
#----------------------------------------------------------------------#  End 1

#
# Script @completer from content/tutorials/wipe-slate.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'deleteTutdirContent' (1/1 in completer) of content/tutorials/wipe-slate.md"
####
if [ -z "${V_TUT}" ]; then
  echo "V_TUT not defined, nothing to do."
else
  if [ -d "${V_TUT}" ]; then
    /bin/rm -rf $V_TUT/*
    echo "Removed contents of $V_TUT"
  else
    echo "Not a directory: V_TUT=\"$V_TUT\""
  fi
fi
#----------------------------------------------------------------------#  End 1

#
# Script @completer from content/tutorials/basics.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'defineService' (1/9 in completer) of content/tutorials/basics.md"
####
mkdir -p $V_TUT/src/fortune/ifc
 cat - <<EOF >$V_TUT/src/fortune/ifc/fortune.vdl
package ifc

type Fortune interface {
  // Returns a random fortune.
  Get() (wisdom string | error)
  // Adds a fortune to the set used by Get().
  Add(wisdom string) error
}
EOF
#----------------------------------------------------------------------#  End 1

#----------------------------------------------------------------------#  Start 2
echo "Block 'compileInterface' (2/9 in completer) of content/tutorials/basics.md"
####
VDLROOT=$VANADIUM_RELEASE/src/v.io/v23/vdlroot \
    VDLPATH=$V_TUT/src \
    $V_BIN/vdl generate --lang go $V_TUT/src/fortune/ifc
go build fortune/ifc
#----------------------------------------------------------------------#  End 2

#----------------------------------------------------------------------#  Start 3
echo "Block 'serviceImpl' (3/9 in completer) of content/tutorials/basics.md"
####
mkdir -p $V_TUT/src/fortune/service
 cat - <<EOF >$V_TUT/src/fortune/service/service.go
package service

import (
  "math/rand"
  "fortune/ifc"
  "sync"
  "v.io/v23/context"
  "v.io/v23/rpc"
)

type impl struct {
  wisdom []string      // All known fortunes.
  random *rand.Rand    // To pick a random index in 'wisdom'.
  mu     sync.RWMutex  // To safely enable concurrent use.
}

// Makes an implementation.
func Make() ifc.FortuneServerMethods {
  return &impl {
    wisdom: []string{
        "You will reach the heights of success.",
        "Conquer your fears or they will conquer you.",
        "Today is your lucky day!",
    },
    random: rand.New(rand.NewSource(99)),
  }
}

func (f *impl) Get(_ *context.T, _ rpc.ServerCall) (blah string, err error) {
  f.mu.RLock()
  defer f.mu.RUnlock()
  if len(f.wisdom) == 0 {
    return "[empty]", nil
  }
  return f.wisdom[f.random.Intn(len(f.wisdom))], nil
}

func (f *impl) Add(_ *context.T, _ rpc.ServerCall, blah string) error {
  f.mu.Lock()
  defer f.mu.Unlock()
  f.wisdom = append(f.wisdom, blah)
  return nil
}
EOF
go build fortune/service
#----------------------------------------------------------------------#  End 3

#----------------------------------------------------------------------#  Start 4
echo "Block 'authorizer' (4/9 in completer) of content/tutorials/basics.md"
####
mkdir -p $V_TUT/src/fortune/server/util
 cat - <<EOF >$V_TUT/src/fortune/server/util/authorizer.go
package util

import (
  "v.io/v23/security"
)

// Returns Vanadium's default authorizer.
func MakeAuthorizer() security.Authorizer {
  return security.DefaultAuthorizer()
}
EOF
go build fortune/server/util
#----------------------------------------------------------------------#  End 4

#----------------------------------------------------------------------#  Start 5
echo "Block 'dispatcher' (5/9 in completer) of content/tutorials/basics.md"
####
mkdir -p $V_TUT/src/fortune/server/util
 cat - <<EOF >$V_TUT/src/fortune/server/util/dispatcher.go
package util

import (
  "v.io/v23/rpc"
)

// Returns nil to trigger use of the default dispatcher.
func MakeDispatcher() (d rpc.Dispatcher) {
  return nil
}
EOF
go build fortune/server/util
#----------------------------------------------------------------------#  End 5

#----------------------------------------------------------------------#  Start 6
echo "Block 'intializer' (6/9 in completer) of content/tutorials/basics.md"
####
mkdir -p $V_TUT/src/fortune/server/util
 cat - <<EOF >$V_TUT/src/fortune/server/util/initializer.go
package util

import (
  "flag"
  "fmt"
  "io/ioutil"
  "log"

  "v.io/v23/naming"
)

var (
  fileName = flag.String(
      "endpoint-file-name", "",
      "Write endpoint address to given file.")
)

func SaveEndpointToFile(e naming.Endpoint) {
  if *fileName == "" {
    return
  }
  contents := []byte(
      naming.JoinAddressName(e.String(), "") + "\n")
  if ioutil.WriteFile(*fileName, contents, 0644) != nil {
    log.Panic("Error writing ", *fileName)
  }
  fmt.Printf("Wrote endpoint name to %v.\n", *fileName)
}

EOF
go build fortune/server/util
#----------------------------------------------------------------------#  End 6

#----------------------------------------------------------------------#  Start 7
echo "Block 'server' (7/9 in completer) of content/tutorials/basics.md"
####
mkdir -p $V_TUT/src/fortune/server
 cat - <<EOF >$V_TUT/src/fortune/server/main.go
package main

import (
  "flag"
  "fmt"
  "log"
  "fortune/ifc"
  "fortune/server/util"
  "fortune/service"

  "v.io/v23"
  "v.io/v23/rpc"
  "v.io/x/ref/lib/signals"
  _ "v.io/x/ref/runtime/factories/generic"
)

var (
  serviceName = flag.String(
      "service-name", "",
      "Name for service in default mount table.")
)

func main() {
  ctx, shutdown := v23.Init()
  defer shutdown()

  // Attach the 'fortune service' implementation
  // defined above to a queriable, textual description
  // of the implementation used for service discovery.
  fortune := ifc.FortuneServer(service.Make())

  // If the dispatcher isn't nil, it's presumed to have
  // obtained its authorizer from util.MakeAuthorizer().
  dispatcher := util.MakeDispatcher()

  // Start serving.
  var err error
  var server rpc.Server
  if dispatcher == nil {
    // Use the default dispatcher.
    _, server, err = v23.WithNewServer(
        ctx, *serviceName, fortune, util.MakeAuthorizer())
  } else {
    _, server, err = v23.WithNewDispatchingServer(
        ctx, *serviceName, dispatcher)
  }
  if err != nil {
    log.Panic("Error serving service: ", err)
  }
  endpoint := server.Status().Endpoints[0]
  util.SaveEndpointToFile(endpoint)
  fmt.Printf("Listening at: %v\n", endpoint)

  // Wait forever.
  <-signals.ShutdownOnSignals(ctx)
}
EOF
go install fortune/server
#----------------------------------------------------------------------#  End 7

#----------------------------------------------------------------------#  Start 8
echo "Block 'client' (8/9 in completer) of content/tutorials/basics.md"
####
mkdir -p $V_TUT/src/fortune/client
 cat - <<EOF >$V_TUT/src/fortune/client/main.go
package main

import (
  "flag"
  "fmt"
  "time"

  "fortune/ifc"

  "v.io/v23"
  "v.io/v23/context"
  "v.io/x/lib/vlog"
  _ "v.io/x/ref/runtime/factories/generic"
)

var (
  server = flag.String(
      "server", "", "Name of the server to connect to")
  newFortune = flag.String(
      "add", "", "A new fortune to add to the server's set")
)

func main() {
  ctx, shutdown := v23.Init()
  defer shutdown()

  if *server == "" {
    vlog.Error("--server must be specified")
    return
  }
  f := ifc.FortuneClient(*server)
  ctx, cancel := context.WithTimeout(ctx, time.Minute)
  defer cancel()

  if *newFortune == "" { // --add flag not specified
    fortune, err := f.Get(ctx)
    if err != nil {
      vlog.Errorf("error getting fortune: %v", err)
      return
    }
    fmt.Println(fortune)
  } else {
    if err := f.Add(ctx, *newFortune); err != nil {
      vlog.Errorf("error adding fortune: %v", err)
      return
    }
  }
}
EOF
go install fortune/client
#----------------------------------------------------------------------#  End 8

#----------------------------------------------------------------------#  Start 9
echo "Block 'principalTutorial' (9/9 in completer) of content/tutorials/basics.md"
####
$V_BIN/principal create \
    --with-passphrase=false \
    --overwrite $V_TUT/cred/basics tutorial
#----------------------------------------------------------------------#  End 9

#
# Script @completer from content/tutorials/syncbase/localPersist.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'defineService' (1/10 in completer) of content/tutorials/syncbase/localPersist.md"
####
mkdir -p $V_TUT/src/fortune/service
 cat - <<EOF >$V_TUT/src/fortune/service/service.go
{{# helpers.codedim}}
package service

import (
  "fortune/ifc"
  "math/rand"
  "strconv"
  "sync"

  "v.io/v23/context"
  "v.io/v23/rpc"
{{/ helpers.codedim}}
  "v.io/v23/syncbase"
{{# helpers.codedim}}
)
{{/ helpers.codedim}}

// Constant names of different Syncbase entities.
const (
  fortuneDatabaseName   = "fortuneDb"
  fortuneCollectionName = "fortuneCollection"

  // A special key that specifies the number of fortunes.
  numFortunesKey = "numFortunes"
)

type impl struct {
  random        *rand.Rand   // To pick a random fortune
  mu            sync.RWMutex // To safely enable concurrent use.

  syncbaseName       string  // The Syncbase endpoint

  sbs syncbase.Service    // Handle to the Syncbase service
  d   syncbase.Database   // Handle to the fortunes database
  c   syncbase.Collection // Handle to the fortunes collection
}

// Makes an implementation.
func Make(ctx *context.T, syncbaseName string) ifc.FortuneServerMethods {
{{# helpers.codedim}}
  impl := &impl{
    random:             rand.New(rand.NewSource(99)),
{{/ helpers.codedim}}
    syncbaseName:       syncbaseName,
  }
  if err := impl.initSyncbase(ctx); err != nil {
    panic(err)
  }
{{# helpers.codedim}}
  return impl
}
{{/ helpers.codedim}}

// Initialize Syncbase by creating a new service, database and collection.
func (f *impl) initSyncbase(ctx *context.T) error {
  // Create a new service handle and a database to store the fortunes.
  sbs := syncbase.NewService(f.syncbaseName)
  d := sbs.Database(ctx, fortuneDatabaseName, nil)
  if err := d.Create(ctx, nil); err != nil {
      return err
  }

  // Create the collection where we store fortunes.
  c := d.Collection(ctx, fortuneCollectionName)
  if err := c.Create(ctx, nil); err != nil {
      return err
  }

{{# helpers.codedim}}
  f.sbs = sbs
  f.d = d
  f.c = c
  return nil
{{/ helpers.codedim}}
}

// Get RPC implementation. Returns a fortune retrieved from Syncbase.
func (f *impl) Get(ctx *context.T, _ rpc.ServerCall) (string, error) {
  f.mu.RLock()
  defer f.mu.RUnlock()

  var numKeys int
  if err := f.c.Get(ctx, numFortunesKey, &numKeys); err != nil || numKeys == 0 {
    return "[empty]", nil
  }

  // Get a random number in the range [0, numKeys) and convert it to a string;
  // this acts as the key in the sycnbase collection.
  key := strconv.Itoa(f.random.Intn(numKeys))
  var value string

  if err := f.c.Get(ctx, key, &value); err == nil {
    return value, nil
  } else {
    return "[error]", err
  }
}

// Add RPC implementation. Adds a new fortune by persisting it to Syncbase.
func (f *impl) Add(ctx *context.T, _ rpc.ServerCall, fortune string) error {
  f.mu.Lock()
  defer f.mu.Unlock()

  var numKeys int
  if err := f.c.Get(ctx, numFortunesKey, &numKeys); err != nil {
    numKeys = 0
  }

  // Put the fortune into Syncbase.
  key := strconv.Itoa(numKeys)
  if err := f.c.Put(ctx, key, &fortune); err != nil {
    return err
  }

  // Update the number of keys.
  return f.c.Put(ctx, numFortunesKey, numKeys+1)
}

EOF
#----------------------------------------------------------------------#  End 1

#----------------------------------------------------------------------#  Start 2
echo "Block 'defineServer' (2/10 in completer) of content/tutorials/syncbase/localPersist.md"
####
mkdir -p $V_TUT/src/fortune/server
 cat - <<EOF >$V_TUT/src/fortune/server/main.go
package main

{{# helpers.codedim }}
import (
  "fmt"
  "flag"
  "fortune/ifc"
  "fortune/server/util"
  "fortune/service"
  "log"

  "v.io/v23"
  "v.io/v23/rpc"
  "v.io/x/ref/lib/signals"
  _ "v.io/x/ref/runtime/factories/generic"
)

var (
  serviceName = flag.String(
    "service-name", "",
    "Name for service in default mount table.")
{{/ helpers.codedim }}
  syncbaseName = flag.String(
    "sb-name", "",
    "Name of Syncbase service")
{{# helpers.codedim }}
)

func main() {
  ctx, shutdown := v23.Init()
  defer shutdown()

{{/ helpers.codedim }}
  fortune := ifc.FortuneServer(service.Make(ctx, *syncbaseName))
{{# helpers.codedim }}

  // If the dispatcher isn't nil, it's presumed to have
  // obtained its authorizer from util.MakeAuthorizer().
  dispatcher := util.MakeDispatcher()

  // Start serving.
  var err error
  var server rpc.Server
  if dispatcher == nil {
    // Use the default dispatcher.
    _, server, err = v23.WithNewServer(
      ctx, *serviceName, fortune, util.MakeAuthorizer())
  } else {
    _, server, err = v23.WithNewDispatchingServer(
      ctx, *serviceName, dispatcher)
  }
  if err != nil {
    log.Panic("Error serving service: ", err)
  }
  endpoint := server.Status().Endpoints[0]
  util.SaveEndpointToFile(endpoint)
  fmt.Printf("Listening at: %v\n", endpoint)

  // Wait forever.
  <-signals.ShutdownOnSignals(ctx)
}
{{/ helpers.codedim }}

EOF
#----------------------------------------------------------------------#  End 2

#----------------------------------------------------------------------#  Start 3
echo "Block 'removeCodeDimMarkup' (3/10 in completer) of content/tutorials/syncbase/localPersist.md"
####
sed -i 's/{{.*}}//' $V_TUT/src/fortune/server/main.go
sed -i 's/{{.*}}//' $V_TUT/src/fortune/service/service.go
#----------------------------------------------------------------------#  End 3

#----------------------------------------------------------------------#  Start 4
echo "Block 'installClientServer' (4/10 in completer) of content/tutorials/syncbase/localPersist.md"
####
go install fortune/server
go install fortune/client
#----------------------------------------------------------------------#  End 4

#----------------------------------------------------------------------#  Start 5
echo "Block 'makeCreds' (5/10 in completer) of content/tutorials/syncbase/localPersist.md"
####
$V_BIN/principal create \
  --with-passphrase=false \
  --overwrite $V_TUT/cred/alice idp:o:fortune:alice
#----------------------------------------------------------------------#  End 5

#----------------------------------------------------------------------#  Start 6
echo "Block 'startSb1' (6/10 in completer) of content/tutorials/syncbase/localPersist.md"
####
$V_BIN/syncbased \
  --v23.tcp.address=127.0.0.1:0 \
  --v23.credentials=$V_TUT/cred/alice > $V_TUT/endpoint 2> /dev/null &
TUT_PID_SB1=$!
while [ ! -s $V_TUT/endpoint ]; do sleep 1; done
#----------------------------------------------------------------------#  End 6

#----------------------------------------------------------------------#  Start 7
echo "Block 'startServer1' (7/10 in completer) of content/tutorials/syncbase/localPersist.md"
####
rm -f $V_TUT/server.txt
$V_TUT/bin/server \
  --v23.credentials=$V_TUT/cred/alice \
  --v23.tcp.address=127.0.0.1:0 \
  --endpoint-file-name=$V_TUT/server.txt \
  --sb-name=`cat $V_TUT/endpoint | grep 'ENDPOINT=' | cut -d'=' -f2` &> /dev/null &
TUT_PID_SERVER1=$!
sleep 2s # Added by mdrip
#----------------------------------------------------------------------#  End 7

#----------------------------------------------------------------------#  Start 8
echo "Block 'initialClientCall' (8/10 in completer) of content/tutorials/syncbase/localPersist.md"
####
$V_TUT/bin/client \
  --v23.credentials=$V_TUT/cred/alice \
  --server=`cat $V_TUT/server.txt` \
  --add='The greatest risk is not taking one.'
#----------------------------------------------------------------------#  End 8

#----------------------------------------------------------------------#  Start 9
echo "Block 'secondClientCall' (9/10 in completer) of content/tutorials/syncbase/localPersist.md"
####
$V_TUT/bin/client \
  --v23.credentials=$V_TUT/cred/alice \
  --server=`cat $V_TUT/server.txt`
#----------------------------------------------------------------------#  End 9

#----------------------------------------------------------------------#  Start 10
echo "Block 'cleanup' (10/10 in completer) of content/tutorials/syncbase/localPersist.md"
####
kill_tut_process TUT_PID_SERVER1
kill_tut_process TUT_PID_SB1
#----------------------------------------------------------------------#  End 10

#
# Script @completer from content/tutorials/syncbase/sync.md 
#
#----------------------------------------------------------------------#  Start 1
echo "Block 'defineService' (1/11 in completer) of content/tutorials/syncbase/sync.md"
####
mkdir -p $V_TUT/src/fortune/service
 cat - <<EOF >$V_TUT/src/fortune/service/service.go
{{# helpers.codedim}}
package service

import (
  "fortune/ifc"
  "math/rand"
  "strconv"
  "strings"
  "sync"

  "v.io/v23/context"
  "v.io/v23/rpc"
  "v.io/v23/security"
  "v.io/v23/security/access"
  wire "v.io/v23/services/syncbase"
  "v.io/v23/syncbase"
)

// Constant names of different Syncbase entities.
const (
  fortuneDatabaseName   = "fortuneDb"
  fortuneCollectionName = "fortuneCollection"
{{/ helpers.codedim}}
  fortuneSyncgroupName  = "fortuneSyncgroup"
{{# helpers.codedim}}

  // A special key that specifies the number of fortunes.
  numFortunesKey = "numFortunes"
)

type impl struct {
  random *rand.Rand   // To pick a random fortune
  mu     sync.RWMutex // To safely enable concurrent use.

  syncbaseName       string // The Syncbase endpoint
  remoteSyncbaseName string // A remote endpoint to connect to

  sbs syncbase.Service    // Handle to the Syncbase service
  d   syncbase.Database   // Handle to the fortunes database
  c   syncbase.Collection // Handle to the fortunes collection
}

// Makes an implementation.
func Make(ctx *context.T, syncbaseName, remoteSyncbaseName string) ifc.FortuneServerMethods {
  impl := &impl{
    random:             rand.New(rand.NewSource(99)),
    syncbaseName:       syncbaseName,
{{/ helpers.codedim}}
    remoteSyncbaseName: remoteSyncbaseName,
{{# helpers.codedim}}
  }

  if err := impl.initSyncbase(ctx); err != nil {
    panic(err)
  }
  return impl
}

// Initialize Syncbase by establishing a new service and creating a new database
// and a new collection.
func (f *impl) initSyncbase(ctx *context.T) error {

  // Create a new service and get its database.
  sbs := syncbase.NewService(f.syncbaseName)
  d := sbs.Database(ctx, fortuneDatabaseName, nil)
  if err := d.Create(ctx, nil); err != nil {
    return err
  }

  // Create the collection where we will store fortunes.
  c := d.Collection(ctx, fortuneCollectionName)
  if err := c.Create(ctx, nil); err != nil {
    return err
  }

{{/ helpers.codedim}}
  // Join a syncgroup if there is someone to connect to, otherwise create one.
  sg := d.Syncgroup(ctx, fortuneSyncgroupName)
  sgPerms := access.Permissions{}
  sgPerms.Add(security.BlessingPattern(sg.Id().Blessing),
    access.TagStrings(wire.AllSyncgroupTags...)...)

  sgSpec := wire.SyncgroupSpec{
    Description: "FortuneSyncgroup",
    Perms:       sgPerms,
    Collections: []wire.Id{c.Id()},
  }
  sgInfo := wire.SyncgroupMemberInfo{SyncPriority: 10}

  if f.remoteSyncbaseName != "" {
    if _, err := sg.Join(ctx, f.remoteSyncbaseName, nil, sgInfo); err != nil {
      return err
    }
  } else {
    if err := sg.Create(ctx, sgSpec, sgInfo); err != nil {
      return err
    }
  }
{{# helpers.codedim}}

  f.sbs = sbs
  f.d = d
  f.c = c
  return nil
}

// Get RPC implementation. Returns a fortune retrieved from Syncbase.
func (f *impl) Get(ctx *context.T, _ rpc.ServerCall) (string, error) {
  f.mu.RLock()
  defer f.mu.RUnlock()

{{/ helpers.codedim}}
  counts := make([]int, 0)
  devices := make([]string, 0)
  it := f.c.Scan(ctx, syncbase.Prefix(numFortunesKey))
  for it.Advance() {
    var numFortunes int
    dev := strings.TrimPrefix(it.Key(), numFortunesKey)
    if err := it.Value(&numFortunes); err != nil {
      return "[error]", err
    }

    if numFortunes > 0 {
      counts = append(counts, numFortunes)
      devices = append(devices, dev)
    }
  }

  if len(counts) == 0 {
    return "[empty]", nil
  }

  index := f.random.Intn(len(counts))
  count := counts[index]
  dev := devices[index]

  // Get a random number in the range [0, numKeys) and convert it to a string;
  // this acts as the key in the fortunes collection.
  key := strconv.Itoa(f.random.Intn(count)) + dev
{{# helpers.codedim}}

  var value string
  if err := f.c.Get(ctx, key, &value); err == nil {
    return value, nil
  } else {
    return "[error]", err
  }
}

// Add RPC implementation. Adds a new fortune by persisting it to Syncbase.
func (f *impl) Add(ctx *context.T, _ rpc.ServerCall, fortune string) error {
  f.mu.Lock()
  defer f.mu.Unlock()
{{/ helpers.codedim}}

  var numKeys int
  if err := f.c.Get(ctx, numFortunesKey+f.syncbaseName, &numKeys); err != nil {
    numKeys = 0
  }

  // Put the fortune into Syncbase.
  key := strconv.Itoa(numKeys)
  if err := f.c.Put(ctx, key+f.syncbaseName, &fortune); err != nil {
    return err
  }

  // Update the number of keys.
  return f.c.Put(ctx, numFortunesKey+f.syncbaseName, numKeys+1)

{{# helpers.codedim}}
}
{{/ helpers.codedim}}


EOF
#----------------------------------------------------------------------#  End 1

#----------------------------------------------------------------------#  Start 2
echo "Block 'defineServer' (2/11 in completer) of content/tutorials/syncbase/sync.md"
####
mkdir -p $V_TUT/src/fortune/server
 cat - <<EOF >$V_TUT/src/fortune/server/main.go
package main

{{# helpers.codedim }}
import (
  "fmt"
  "flag"
  "fortune/ifc"
  "fortune/server/util"
  "fortune/service"
  "log"

  "v.io/v23"
  "v.io/v23/rpc"
  "v.io/x/ref/lib/signals"
  _ "v.io/x/ref/runtime/factories/generic"
)

var (
  serviceName = flag.String(
    "service-name", "",
    "Name for service in default mount table.")
  syncbaseName = flag.String(
    "sb-name", "",
    "Name of Syncbase service")
{{/ helpers.codedim }}
  remoteSyncbaseName = flag.String(
    "remote-sb-name", "",
    "Name of remote Syncbase service")
{{# helpers.codedim }}
)

func main() {
  ctx, shutdown := v23.Init()
  defer shutdown()
{{/ helpers.codedim }}
  fortune := ifc.FortuneServer(service.Make(ctx, *syncbaseName,  *remoteSyncbaseName))
{{# helpers.codedim }}

  // If the dispatcher isn't nil, it's presumed to have
  // obtained its authorizer from util.MakeAuthorizer().
  dispatcher := util.MakeDispatcher()

  // Start serving.
  var err error
  var server rpc.Server
  if dispatcher == nil {
    // Use the default dispatcher.
    _, server, err = v23.WithNewServer(
      ctx, *serviceName, fortune, util.MakeAuthorizer())
  } else {
    _, server, err = v23.WithNewDispatchingServer(
      ctx, *serviceName, dispatcher)
  }
  if err != nil {
    log.Panic("Error serving service: ", err)
  }
  endpoint := server.Status().Endpoints[0]
  util.SaveEndpointToFile(endpoint)
  fmt.Printf("Listening at: %v\n", endpoint)

  // Wait forever.
  <-signals.ShutdownOnSignals(ctx)
}
{{/ helpers.codedim }}

EOF
#----------------------------------------------------------------------#  End 2

#----------------------------------------------------------------------#  Start 3
echo "Block 'removeCodeDimMarkup' (3/11 in completer) of content/tutorials/syncbase/sync.md"
####
sed -i 's/{{.*}}//' $V_TUT/src/fortune/server/main.go
sed -i 's/{{.*}}//' $V_TUT/src/fortune/service/service.go
#----------------------------------------------------------------------#  End 3

#----------------------------------------------------------------------#  Start 4
echo "Block 'installClientServer' (4/11 in completer) of content/tutorials/syncbase/sync.md"
####
go install fortune/server
go install fortune/client
#----------------------------------------------------------------------#  End 4

#----------------------------------------------------------------------#  Start 5
echo "Block 'startSb1' (5/11 in completer) of content/tutorials/syncbase/sync.md"
####
syncbased \
  --v23.credentials=$V_TUT/cred/alice \
  --v23.tcp.address=127.0.0.1:0 > $V_TUT/endpoint1  2> /dev/null &
TUT_PID_SB1=$!
while [ ! -s $V_TUT/endpoint1 ]; do sleep 1; done
sleep 2s # Added by mdrip
#----------------------------------------------------------------------#  End 5

#----------------------------------------------------------------------#  Start 6
echo "Block 'startServer1' (6/11 in completer) of content/tutorials/syncbase/sync.md"
####
rm -f $V_TUT/server1.txt $V_TUT/server2.txt
$V_TUT/bin/server \
  --v23.credentials=$V_TUT/cred/alice \
  --v23.tcp.address=127.0.0.1:0 \
  --endpoint-file-name=$V_TUT/server1.txt \
  --sb-name=`cat $V_TUT/endpoint1 | grep 'ENDPOINT=' | cut -d'=' -f2` &> /dev/null &
TUT_PID_SERVER1=$!
sleep 2s # Added by mdrip
#----------------------------------------------------------------------#  End 6

#----------------------------------------------------------------------#  Start 7
echo "Block 'startSb2' (7/11 in completer) of content/tutorials/syncbase/sync.md"
####
syncbased \
  --v23.tcp.address=127.0.0.1:0 \
  --v23.credentials=$V_TUT/cred/alice > $V_TUT/endpoint2 2> /dev/null &
TUT_PID_SB2=$!
while [ ! -s $V_TUT/endpoint2 ]; do sleep 1; done
sleep 2s # Added by mdrip
#----------------------------------------------------------------------#  End 7

#----------------------------------------------------------------------#  Start 8
echo "Block 'startServer2' (8/11 in completer) of content/tutorials/syncbase/sync.md"
####
$V_TUT/bin/server \
  --v23.credentials=$V_TUT/cred/alice \
  --v23.tcp.address=127.0.0.1:0 \
  --endpoint-file-name=$V_TUT/server2.txt \
  --sb-name=`cat $V_TUT/endpoint2 | grep 'ENDPOINT=' | cut -d'=' -f2` \
  --remote-sb-name=`cat $V_TUT/endpoint1 | grep 'ENDPOINT=' | cut -d'=' -f2` &> /dev/null &
TUT_PID_SERVER2=$!
sleep 2s # Added by mdrip
#----------------------------------------------------------------------#  End 8

#----------------------------------------------------------------------#  Start 9
echo "Block 'initialClientCall' (9/11 in completer) of content/tutorials/syncbase/sync.md"
####
$V_TUT/bin/client \
  --v23.credentials=$V_TUT/cred/alice \
  --server=`cat $V_TUT/server1.txt` \
  --add "The greatest risk is not taking one."

$V_TUT/bin/client \
  --v23.credentials=$V_TUT/cred/alice \
  --server=`cat $V_TUT/server2.txt` \
  --add "A new challenge is near."
#----------------------------------------------------------------------#  End 9

#----------------------------------------------------------------------#  Start 10
echo "Block 'getClientCall' (10/11 in completer) of content/tutorials/syncbase/sync.md"
####
$V_TUT/bin/client \
  --v23.credentials=$V_TUT/cred/alice \
  --server=`cat $V_TUT/server1.txt`
#----------------------------------------------------------------------#  End 10

#----------------------------------------------------------------------#  Start 11
echo "Block 'cleanup' (11/11 in completer) of content/tutorials/syncbase/sync.md"
####
kill_tut_process TUT_PID_SERVER1
kill_tut_process TUT_PID_SERVER2
kill_tut_process TUT_PID_SB1
kill_tut_process TUT_PID_SB2
rm -f $V_TUT/server1.txt
rm -f $V_TUT/server2.txt
#----------------------------------------------------------------------#  End 11

echo " "
echo "All done.  No errors."
HANDLED_SCRIPT
